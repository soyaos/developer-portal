import {
  beginInference,
  ControlPlaneError,
  finalizeInference,
  verifyApiKey,
  type VerifiedApiKey,
} from "./control-plane";

export const PUBLIC_MODEL_ID = "soya:starter";
export const WORKERS_AI_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_MESSAGES = 32;
const MAX_MESSAGE_CHARS = 16_000;
const MAX_OUTPUT_TOKENS = 2_048;
const DEFAULT_OUTPUT_TOKENS = 512;
const MAX_SSE_EVENT_BYTES = 1024 * 1024;
const TRUSTED_BROWSER_ORIGIN = "https://developer.soyaos.ai";
const encoder = new TextEncoder();

type ChatRole = "system" | "user" | "assistant";

interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface ValidatedChatRequest {
  messages: ChatMessage[];
  stream: boolean;
  maxTokens: number;
  temperature?: number;
  topP?: number;
  promptTokens: number;
}

export interface InferenceRunInput {
  messages: ChatMessage[];
  stream: boolean;
  maxTokens: number;
  temperature?: number;
  topP?: number;
  signal: AbortSignal;
}

export type InferenceRunner = (
  input: InferenceRunInput,
) => Promise<unknown | ReadableStream<Uint8Array>>;

export interface InferenceHandlerOptions {
  now?: () => number;
  run?: InferenceRunner;
}

class InferenceApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "InferenceApiError";
  }
}

interface CompletionResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  finishReason: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function requestId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, "")}`;
}

function traceId(): string {
  return `trace_${crypto.randomUUID().replace(/-/g, "")}`;
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    "access-control-expose-headers": "x-request-id,retry-after",
    "cache-control": "no-store",
    vary: "Origin",
  });
  if (request.headers.get("origin") === TRUSTED_BROWSER_ORIGIN) {
    headers.set("access-control-allow-origin", TRUSTED_BROWSER_ORIGIN);
  }
  return headers;
}

function apiResponse(
  request: Request,
  id: string,
  body: BodyInit | null,
  init: ResponseInit = {},
): Response {
  const headers = corsHeaders(request);
  const provided = new Headers(init.headers);
  provided.forEach((value, name) => headers.set(name, value));
  headers.set("x-request-id", id);
  return new Response(body, { ...init, headers });
}

function jsonResponse(
  request: Request,
  id: string,
  data: unknown,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return apiResponse(request, id, JSON.stringify(data), { ...init, headers });
}

function errorType(status: number): string {
  if (status === 401) return "authentication_error";
  if (status === 403) return "permission_error";
  if (status === 429) return "rate_limit_error";
  if (status >= 500) return "api_error";
  return "invalid_request_error";
}

function normalizeError(error: unknown): InferenceApiError {
  if (error instanceof InferenceApiError) return error;
  if (error instanceof ControlPlaneError) {
    return new InferenceApiError(error.status, error.code, error.message, error.retryAfter);
  }
  return new InferenceApiError(500, "internal_error", "An unexpected error occurred.");
}

function errorResponse(request: Request, id: string, error: unknown): Response {
  const normalized = normalizeError(error);
  if (normalized.status >= 500 && normalized.code === "internal_error") {
    console.error(
      JSON.stringify({
        message: "unhandled inference API error",
        requestId: id,
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
  }
  const headers = normalized.retryAfter
    ? { "retry-after": String(normalized.retryAfter) }
    : undefined;
  return jsonResponse(
    request,
    id,
    {
      error: {
        message: normalized.message,
        type: errorType(normalized.status),
        code: normalized.code,
      },
    },
    { status: normalized.status, headers },
  );
}

function requireDatabase(env: PortalEnv): D1Database {
  if (!env.DB) {
    throw new InferenceApiError(503, "database_unavailable", "Inference is unavailable.", 30);
  }
  return env.DB;
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(authorization);
  const token = match?.[1];
  if (!token) {
    throw new InferenceApiError(401, "invalid_api_key", "Invalid API key.");
  }
  return token;
}

async function authenticate(
  request: Request,
  env: PortalEnv,
  requiredScope: string,
  now: number,
): Promise<VerifiedApiKey> {
  const db = requireDatabase(env);
  const verified = await verifyApiKey(
    db,
    bearerToken(request),
    env.API_KEY_PEPPER?.trim() ?? "",
    now,
  );
  if (!verified) {
    throw new InferenceApiError(401, "invalid_api_key", "Invalid API key.");
  }
  if (!verified.scopes.includes(requiredScope)) {
    throw new InferenceApiError(403, "insufficient_scope", "API key lacks required scope.");
  }
  return verified;
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new InferenceApiError(415, "unsupported_media_type", "Expected application/json.");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new InferenceApiError(413, "request_too_large", "Request body is too large.");
  }
  if (!request.body) {
    throw new InferenceApiError(400, "invalid_request", "A JSON request body is required.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_REQUEST_BYTES) {
      await reader.cancel("request body exceeds limit");
      throw new InferenceApiError(413, "request_too_large", "Request body is too large.");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new InferenceApiError(400, "invalid_json", "Request body must be valid JSON.");
  }
}

function estimateTokens(text: string): number {
  let ascii = 0;
  let nonAscii = 0;
  for (const character of text) {
    if (character.charCodeAt(0) <= 0x7f) ascii += 1;
    else nonAscii += 1;
  }
  return Math.max(1, Math.ceil(ascii / 4) + nonAscii);
}

function validateChatRequest(body: unknown): ValidatedChatRequest {
  if (!isRecord(body)) {
    throw new InferenceApiError(400, "invalid_request", "Request body must be a JSON object.");
  }
  if (body.model !== PUBLIC_MODEL_ID) {
    throw new InferenceApiError(404, "model_not_found", "The requested model does not exist.");
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new InferenceApiError(400, "invalid_messages", "At least one message is required.");
  }
  if (body.messages.length > MAX_MESSAGES) {
    throw new InferenceApiError(400, "invalid_messages", `At most ${MAX_MESSAGES} messages are allowed.`);
  }

  const messages: ChatMessage[] = [];
  for (const value of body.messages) {
    if (!isRecord(value)) {
      throw new InferenceApiError(400, "invalid_messages", "Every message must be an object.");
    }
    if (value.role !== "system" && value.role !== "user" && value.role !== "assistant") {
      throw new InferenceApiError(400, "unsupported_message_role", "Unsupported message role.");
    }
    if (typeof value.content !== "string" || !value.content.trim()) {
      throw new InferenceApiError(400, "invalid_messages", "Message content must be non-empty text.");
    }
    if (value.content.length > MAX_MESSAGE_CHARS) {
      throw new InferenceApiError(400, "invalid_messages", "A message is too long.");
    }
    messages.push({ role: value.role, content: value.content });
  }
  if (!messages.some((message) => message.role === "user")) {
    throw new InferenceApiError(400, "invalid_messages", "At least one user message is required.");
  }

  const stream = body.stream === undefined ? false : body.stream;
  if (typeof stream !== "boolean") {
    throw new InferenceApiError(400, "invalid_stream", "stream must be a boolean.");
  }
  const maxTokens = body.max_tokens === undefined ? DEFAULT_OUTPUT_TOKENS : body.max_tokens;
  if (
    typeof maxTokens !== "number" ||
    !Number.isSafeInteger(maxTokens) ||
    maxTokens < 1 ||
    maxTokens > MAX_OUTPUT_TOKENS
  ) {
    throw new InferenceApiError(
      400,
      "invalid_max_tokens",
      `max_tokens must be an integer between 1 and ${MAX_OUTPUT_TOKENS}.`,
    );
  }
  const temperature = body.temperature;
  if (
    temperature !== undefined &&
    (typeof temperature !== "number" || !Number.isFinite(temperature) || temperature < 0 || temperature > 2)
  ) {
    throw new InferenceApiError(400, "invalid_temperature", "temperature must be between 0 and 2.");
  }
  const topP = body.top_p;
  if (
    topP !== undefined &&
    (typeof topP !== "number" || !Number.isFinite(topP) || topP <= 0 || topP > 1)
  ) {
    throw new InferenceApiError(400, "invalid_top_p", "top_p must be greater than 0 and at most 1.");
  }
  if (body.tools !== undefined || body.tool_choice !== undefined) {
    throw new InferenceApiError(400, "unsupported_tools", "Tool calls are not available in Public Preview.");
  }

  const promptTokens = messages.reduce(
    (total, message) => total + estimateTokens(message.content) + 4,
    2,
  );
  return {
    messages,
    stream,
    maxTokens,
    temperature,
    topP,
    promptTokens,
  };
}

async function defaultRunner(env: PortalEnv, input: InferenceRunInput) {
  if (!env.AI) {
    throw new InferenceApiError(503, "model_unavailable", "The model is unavailable.", 30);
  }
  const modelInput = {
    messages: input.messages,
    max_tokens: input.maxTokens,
    temperature: input.temperature,
    top_p: input.topP,
  };
  try {
    if (input.stream) {
      return await env.AI.run(
        WORKERS_AI_MODEL,
        { ...modelInput, stream: true },
        { signal: input.signal, tags: ["soya:starter"] },
      );
    }
    return await env.AI.run(
      WORKERS_AI_MODEL,
      { ...modelInput, stream: false },
      { signal: input.signal, tags: ["soya:starter"] },
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "Workers AI inference failed",
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
    throw new InferenceApiError(503, "upstream_unavailable", "The model is temporarily unavailable.", 30);
  }
}

function extractUsage(value: unknown): { promptTokens: number | null; completionTokens: number | null } {
  if (!isRecord(value) || !isRecord(value.usage)) {
    return { promptTokens: null, completionTokens: null };
  }
  return {
    promptTokens: nonNegativeInteger(value.usage.prompt_tokens),
    completionTokens: nonNegativeInteger(value.usage.completion_tokens),
  };
}

function extractCompletion(value: unknown, fallbackPromptTokens: number): CompletionResult {
  if (typeof value === "string" && value) {
    return {
      content: value,
      promptTokens: fallbackPromptTokens,
      completionTokens: estimateTokens(value),
      finishReason: "stop",
    };
  }
  if (!isRecord(value)) {
    throw new InferenceApiError(502, "upstream_invalid_response", "The model returned an invalid response.");
  }

  let content: string | null = typeof value.response === "string" ? value.response : null;
  let finishReason = "stop";
  if (Array.isArray(value.choices) && isRecord(value.choices[0])) {
    const choice = value.choices[0];
    if (isRecord(choice.message) && typeof choice.message.content === "string") {
      content = choice.message.content;
    }
    if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason;
  }
  if (!content) {
    throw new InferenceApiError(502, "upstream_invalid_response", "The model returned an invalid response.");
  }
  const usage = extractUsage(value);
  return {
    content,
    promptTokens: usage.promptTokens ?? fallbackPromptTokens,
    completionTokens: usage.completionTokens ?? estimateTokens(content),
    finishReason,
  };
}

function openAiChunk(
  id: string,
  created: number,
  delta: Record<string, unknown>,
  finishReason: string | null,
): string {
  return `data: ${JSON.stringify({
    id: `chatcmpl-${id.slice(4)}`,
    object: "chat.completion.chunk",
    created,
    model: PUBLIC_MODEL_ID,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

function streamDelta(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.response === "string") return value.response;
  if (!Array.isArray(value.choices) || !isRecord(value.choices[0])) return null;
  const choice = value.choices[0];
  if (isRecord(choice.delta) && typeof choice.delta.content === "string") {
    return choice.delta.content;
  }
  if (isRecord(choice.message) && typeof choice.message.content === "string") {
    return choice.message.content;
  }
  return null;
}

function parseSseEvents(buffer: string): { events: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  return { events: parts.slice(0, -1), rest: parts.at(-1) ?? "" };
}

function eventData(event: string): string {
  return event
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
}

function relayStream(
  upstream: ReadableStream<Uint8Array>,
  db: D1Database,
  verified: VerifiedApiKey,
  id: string,
  trace: string,
  parsed: ValidatedChatRequest,
  startedAt: number,
  created: number,
): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  const queue: Uint8Array[] = [
    encoder.encode(openAiChunk(id, created, { role: "assistant" }, null)),
  ];
  let buffer = "";
  let completionText = "";
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;
  let upstreamDone = false;
  let finished = false;
  let finalized = false;

  const finalize = async (status: "success" | "error", statusCode: number, code?: string) => {
    if (finalized) return;
    finalized = true;
    await finalizeInference(db, {
      requestId: id,
      tenantId: verified.tenantId,
      apiKeyId: verified.keyId,
      traceId: trace,
      model: PUBLIC_MODEL_ID,
      promptTokens: promptTokens ?? parsed.promptTokens,
      completionTokens:
        completionTokens ?? (completionText ? estimateTokens(completionText) : 0),
      statusCode,
      status,
      errorCode: code ?? null,
      latencyMs: Math.max(0, Date.now() - startedAt),
      createdAt: startedAt,
    });
  };

  const handleEvent = (event: string) => {
    const data = eventData(event);
    if (!data) return;
    if (data === "[DONE]") {
      upstreamDone = true;
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    const delta = streamDelta(payload);
    if (delta) {
      completionText += delta;
      queue.push(encoder.encode(openAiChunk(id, created, { content: delta }, null)));
    }
    const usage = extractUsage(payload);
    if (usage.promptTokens !== null) promptTokens = usage.promptTokens;
    if (usage.completionTokens !== null) completionTokens = usage.completionTokens;
  };

  const finishSuccess = async () => {
    if (finished) return;
    await finalize("success", 200);
    queue.push(encoder.encode(openAiChunk(id, created, {}, "stop")));
    queue.push(encoder.encode("data: [DONE]\n\n"));
    finished = true;
  };

  const finishError = async (error: unknown) => {
    if (finished) return;
    console.error(
      JSON.stringify({
        message: "Workers AI stream failed",
        requestId: id,
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
    try {
      await finalize("error", 503, "upstream_stream_error");
    } catch (finalizeError) {
      console.error(
        JSON.stringify({
          message: "stream metadata finalization failed",
          requestId: id,
          error: finalizeError instanceof Error ? finalizeError.message : "unknown",
        }),
      );
    }
    queue.push(
      encoder.encode(
        `data: ${JSON.stringify({
          error: {
            message: "The model stream was interrupted.",
            type: "api_error",
            code: "upstream_stream_error",
          },
        })}\n\n`,
      ),
    );
    queue.push(encoder.encode("data: [DONE]\n\n"));
    finished = true;
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (queue.length === 0 && !finished) {
          if (upstreamDone) {
            await reader.cancel("upstream sent DONE");
            await finishSuccess();
            break;
          }
          const { done, value } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            if (buffer.trim()) handleEvent(buffer);
            await finishSuccess();
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          if (encoder.encode(buffer).byteLength > MAX_SSE_EVENT_BYTES) {
            throw new InferenceApiError(502, "upstream_invalid_stream", "The model stream is invalid.");
          }
          const parsedEvents = parseSseEvents(buffer);
          buffer = parsedEvents.rest;
          for (const event of parsedEvents.events) handleEvent(event);
        }
        const next = queue.shift();
        if (next) controller.enqueue(next);
        else if (finished) controller.close();
      } catch (error) {
        await finishError(error);
        const next = queue.shift();
        if (next) controller.enqueue(next);
        else controller.close();
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
      try {
        await finalize("error", 499, "client_cancelled");
      } catch (error) {
        console.error(
          JSON.stringify({
            message: "cancelled stream metadata finalization failed",
            requestId: id,
            error: error instanceof Error ? error.message : "unknown",
          }),
        );
      }
    },
  });
}

export function handleInferenceOptions(request: Request): Response {
  const id = requestId();
  const headers = new Headers({
    "access-control-allow-headers": "authorization,content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-max-age": "86400",
  });
  return apiResponse(request, id, null, { status: 204, headers });
}

export async function handleModelsRequest(
  request: Request,
  env: PortalEnv,
  options: InferenceHandlerOptions = {},
): Promise<Response> {
  const id = requestId();
  const now = options.now?.() ?? Date.now();
  try {
    await authenticate(request, env, "models:read", now);
    return jsonResponse(request, id, {
      object: "list",
      data: [
        {
          id: PUBLIC_MODEL_ID,
          object: "model",
          created: Math.floor(now / 1000),
          owned_by: "soyaos",
        },
      ],
    });
  } catch (error) {
    return errorResponse(request, id, error);
  }
}

export async function handleChatCompletionsRequest(
  request: Request,
  env: PortalEnv,
  options: InferenceHandlerOptions = {},
): Promise<Response> {
  const id = requestId();
  const trace = traceId();
  const startedAt = options.now?.() ?? Date.now();
  const created = Math.floor(startedAt / 1000);
  let verified: VerifiedApiKey | null = null;
  let parsed: ValidatedChatRequest | null = null;
  let reserved = false;
  try {
    const db = requireDatabase(env);
    verified = await authenticate(request, env, "chat:write", startedAt);
    parsed = validateChatRequest(await readBoundedJson(request));
    await beginInference(db, {
      requestId: id,
      tenantId: verified.tenantId,
      apiKeyId: verified.keyId,
      model: PUBLIC_MODEL_ID,
      reservedTokens: parsed.promptTokens + parsed.maxTokens,
      createdAt: startedAt,
    });
    reserved = true;

    const run = options.run ?? ((input: InferenceRunInput) => defaultRunner(env, input));
    const output = await run({
      messages: parsed.messages,
      stream: parsed.stream,
      maxTokens: parsed.maxTokens,
      temperature: parsed.temperature,
      topP: parsed.topP,
      signal: request.signal,
    });

    if (parsed.stream) {
      if (!(output instanceof ReadableStream)) {
        throw new InferenceApiError(502, "upstream_invalid_response", "The model returned an invalid stream.");
      }
      const stream = relayStream(
        output,
        db,
        verified,
        id,
        trace,
        parsed,
        startedAt,
        created,
      );
      return apiResponse(request, id, stream, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
        },
      });
    }

    const completion = extractCompletion(output, parsed.promptTokens);
    await finalizeInference(db, {
      requestId: id,
      tenantId: verified.tenantId,
      apiKeyId: verified.keyId,
      traceId: trace,
      model: PUBLIC_MODEL_ID,
      promptTokens: completion.promptTokens,
      completionTokens: completion.completionTokens,
      statusCode: 200,
      status: "success",
      latencyMs: Math.max(0, (options.now?.() ?? Date.now()) - startedAt),
      createdAt: startedAt,
    });
    return jsonResponse(request, id, {
      id: `chatcmpl-${id.slice(4)}`,
      object: "chat.completion",
      created,
      model: PUBLIC_MODEL_ID,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: completion.content },
          finish_reason: completion.finishReason,
        },
      ],
      usage: {
        prompt_tokens: completion.promptTokens,
        completion_tokens: completion.completionTokens,
        total_tokens: completion.promptTokens + completion.completionTokens,
      },
    });
  } catch (error) {
    const normalized = normalizeError(error);
    if (reserved && verified && parsed && env.DB) {
      try {
        await finalizeInference(env.DB, {
          requestId: id,
          tenantId: verified.tenantId,
          apiKeyId: verified.keyId,
          traceId: trace,
          model: PUBLIC_MODEL_ID,
          promptTokens: parsed.promptTokens,
          completionTokens: 0,
          statusCode: normalized.status,
          status: "error",
          errorCode: normalized.code,
          latencyMs: Math.max(0, (options.now?.() ?? Date.now()) - startedAt),
          createdAt: startedAt,
        });
      } catch (finalizeError) {
        console.error(
          JSON.stringify({
            message: "inference failure metadata finalization failed",
            requestId: id,
            error: finalizeError instanceof Error ? finalizeError.message : "unknown",
          }),
        );
      }
    }
    return errorResponse(request, id, normalized);
  }
}
