export const INFERENCE_API_BASE = "https://api.soyaos.ai/v1";

const MAX_STREAM_BUFFER_BYTES = 1024 * 1024;

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface PlaygroundUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface PlaygroundCompletion {
  content: string;
  requestId: string;
  usage: PlaygroundUsage | null;
}

export interface CompletionInput {
  apiKey: string;
  model: string;
  prompt: string;
  stream: boolean;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
}

export class PlaygroundApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null,
    readonly retryAfter: number | null,
  ) {
    super(message);
    this.name = "PlaygroundApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

async function responseError(response: Response): Promise<PlaygroundApiError> {
  let code = "request_failed";
  let message = `Request failed (${response.status}).`;
  try {
    const payload: unknown = await response.json();
    if (isRecord(payload) && isRecord(payload.error)) {
      if (typeof payload.error.code === "string") code = payload.error.code;
      if (typeof payload.error.message === "string") message = payload.error.message;
    }
  } catch {
    // Keep the status-based fallback when an upstream proxy returns non-JSON.
  }
  const retryHeader = response.headers.get("retry-after");
  const retryValue = retryHeader === null ? Number.NaN : Number(retryHeader);
  return new PlaygroundApiError(
    response.status,
    code,
    message,
    response.headers.get("x-request-id"),
    Number.isFinite(retryValue) && retryValue > 0 ? retryValue : null,
  );
}

function authorization(apiKey: string): HeadersInit {
  return {
    accept: "application/json",
    authorization: `Bearer ${apiKey}`,
  };
}

export async function listPlaygroundModels(
  apiKey: string,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<string[]> {
  const response = await fetcher(`${INFERENCE_API_BASE}/models`, {
    headers: authorization(apiKey),
    signal,
  });
  if (!response.ok) throw await responseError(response);
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new PlaygroundApiError(
      502,
      "invalid_response",
      "The models response was invalid.",
      response.headers.get("x-request-id"),
      null,
    );
  }
  const models = payload.data.flatMap((value) =>
    isRecord(value) && typeof value.id === "string" ? [value.id] : [],
  );
  if (models.length === 0) {
    throw new PlaygroundApiError(
      502,
      "no_models",
      "No models are currently available.",
      response.headers.get("x-request-id"),
      null,
    );
  }
  return models;
}

function usageFrom(value: unknown): PlaygroundUsage | null {
  if (!isRecord(value)) return null;
  const promptTokens = nonNegativeInteger(value.prompt_tokens);
  const completionTokens = nonNegativeInteger(value.completion_tokens);
  const totalTokens = nonNegativeInteger(value.total_tokens);
  if (promptTokens === null || completionTokens === null || totalTokens === null) {
    return null;
  }
  return { promptTokens, completionTokens, totalTokens };
}

function completionContent(payload: unknown): string | null {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return null;
  const choice = payload.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return null;
  return typeof choice.message.content === "string" && choice.message.content
    ? choice.message.content
    : null;
}

function chunkDelta(payload: unknown): string | null {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return null;
  const choice = payload.choices[0];
  if (!isRecord(choice) || !isRecord(choice.delta)) return null;
  return typeof choice.delta.content === "string" ? choice.delta.content : null;
}

function eventData(event: string): string {
  return event
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
}

async function readCompletionStream(
  response: Response,
  onDelta?: (delta: string) => void,
): Promise<string> {
  if (!response.body) {
    throw new PlaygroundApiError(
      502,
      "invalid_stream",
      "The model returned an empty stream.",
      response.headers.get("x-request-id"),
      null,
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let content = "";
  let doneEvent = false;

  const handleEvent = (event: string) => {
    const data = eventData(event);
    if (!data) return;
    if (data === "[DONE]") {
      doneEvent = true;
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      throw new PlaygroundApiError(
        502,
        "invalid_stream",
        "The model returned an invalid stream event.",
        response.headers.get("x-request-id"),
        null,
      );
    }
    if (isRecord(payload) && isRecord(payload.error)) {
      throw new PlaygroundApiError(
        502,
        typeof payload.error.code === "string" ? payload.error.code : "stream_error",
        typeof payload.error.message === "string"
          ? payload.error.message
          : "The model stream was interrupted.",
        response.headers.get("x-request-id"),
        null,
      );
    }
    const delta = chunkDelta(payload);
    if (delta) {
      content += delta;
      onDelta?.(delta);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      break;
    }
    buffer = `${buffer}${decoder.decode(value, { stream: true })}`.replace(/\r\n/g, "\n");
    if (encoder.encode(buffer).byteLength > MAX_STREAM_BUFFER_BYTES) {
      await reader.cancel("stream event exceeded client limit");
      throw new PlaygroundApiError(
        502,
        "stream_too_large",
        "A model stream event exceeded the client limit.",
        response.headers.get("x-request-id"),
        null,
      );
    }
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) handleEvent(event);
  }
  buffer = `${buffer}${decoder.decode()}`.replace(/\r\n/g, "\n");
  if (buffer.trim()) handleEvent(buffer);
  if (!doneEvent || !content) {
    throw new PlaygroundApiError(
      502,
      "incomplete_stream",
      "The model stream ended before completion.",
      response.headers.get("x-request-id"),
      null,
    );
  }
  return content;
}

export async function runPlaygroundCompletion(
  input: CompletionInput,
  fetcher: Fetcher = fetch,
): Promise<PlaygroundCompletion> {
  const response = await fetcher(`${INFERENCE_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      ...authorization(input.apiKey),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      messages: [{ role: "user", content: input.prompt }],
      max_tokens: 512,
      stream: input.stream,
    }),
    signal: input.signal,
  });
  if (!response.ok) throw await responseError(response);
  const requestId = response.headers.get("x-request-id");
  if (!requestId) {
    throw new PlaygroundApiError(
      502,
      "missing_request_id",
      "The response did not include a request ID.",
      null,
      null,
    );
  }

  if (input.stream) {
    return {
      content: await readCompletionStream(response, input.onDelta),
      requestId,
      usage: null,
    };
  }

  const payload: unknown = await response.json();
  const content = completionContent(payload);
  if (!content || !isRecord(payload)) {
    throw new PlaygroundApiError(
      502,
      "invalid_response",
      "The model response was invalid.",
      requestId,
      null,
    );
  }
  return {
    content,
    requestId,
    usage: usageFrom(payload.usage),
  };
}
