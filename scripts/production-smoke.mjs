import { pathToFileURL } from "node:url";

const API_BASE = "https://api.soyaos.ai";
const PUBLIC_MODEL = "soya:starter";
const API_KEY_PATTERN = /^sk-soya-[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{43}$/;
const REQUEST_ID_PATTERN = /^req_[a-f0-9]{32}$/;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 1_048_576;
const SMOKE_PROMPT = "Reply with exactly one lowercase word: ready";

export class ProductionSmokeFailure extends Error {
  constructor(check, code, status = null, requestId = null) {
    super(`${check}: ${code}`);
    this.name = "ProductionSmokeFailure";
    this.check = check;
    this.code = code;
    this.status = Number.isInteger(status) ? status : null;
    this.requestId = typeof requestId === "string" && REQUEST_ID_PATTERN.test(requestId)
      ? requestId
      : null;
  }
}

function fail(check, code, status = null, requestId = null) {
  throw new ProductionSmokeFailure(check, code, status, requestId);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function requiredRequestId(response, check) {
  const requestId = response.headers.get("x-request-id");
  if (!requestId || !REQUEST_ID_PATTERN.test(requestId)) {
    fail(check, "invalid_request_id");
  }
  return requestId;
}

function requireContentType(response, check, expected) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith(expected)) fail(check, "invalid_content_type");
}

async function readBodyLimited(response, check) {
  if (!response.body) fail(check, "missing_response_body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let body = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      fail(check, "response_too_large");
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  return body;
}

async function readJson(response, check) {
  const body = await readBodyLimited(response, check);
  try {
    return JSON.parse(body);
  } catch {
    fail(check, "invalid_json");
  }
}

async function request(fetcher, check, path, apiKey, init = {}) {
  try {
    return await fetcher(`${API_BASE}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        ...init.headers,
      },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    fail(check, "network_error");
  }
}

function requireOk(response, check) {
  if (response.status !== 200) {
    fail(
      check,
      "unexpected_status",
      response.status,
      response.headers.get("x-request-id"),
    );
  }
}

async function checkModels(fetcher, apiKey) {
  const check = "models";
  const response = await request(fetcher, check, "/v1/models", apiKey);
  requireOk(response, check);
  requireContentType(response, check, "application/json");
  const requestId = requiredRequestId(response, check);
  const payload = await readJson(response, check);
  if (
    !isRecord(payload) ||
    payload.object !== "list" ||
    !Array.isArray(payload.data) ||
    !payload.data.some(
      (model) => isRecord(model) && model.id === PUBLIC_MODEL && model.object === "model",
    )
  ) {
    fail(check, "model_contract_mismatch");
  }
  return { requestId };
}

async function checkNonStreaming(fetcher, apiKey) {
  const check = "chat-non-stream";
  const response = await request(fetcher, check, "/v1/chat/completions", apiKey, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: PUBLIC_MODEL,
      messages: [{ role: "user", content: SMOKE_PROMPT }],
      max_tokens: 512,
      stream: false,
    }),
  });
  requireOk(response, check);
  requireContentType(response, check, "application/json");
  const requestId = requiredRequestId(response, check);
  const payload = await readJson(response, check);
  const choice = isRecord(payload) && Array.isArray(payload.choices) ? payload.choices[0] : null;
  const message = isRecord(choice) && isRecord(choice.message) ? choice.message : null;
  if (
    !isRecord(payload) ||
    payload.object !== "chat.completion" ||
    payload.model !== PUBLIC_MODEL ||
    !isRecord(message) ||
    message.role !== "assistant" ||
    typeof message.content !== "string" ||
    message.content.trim().length === 0
  ) {
    fail(check, "completion_contract_mismatch");
  }

  const usage = isRecord(payload.usage) ? payload.usage : null;
  const promptTokens = isRecord(usage) ? nonNegativeInteger(usage.prompt_tokens) : null;
  const completionTokens = isRecord(usage) ? nonNegativeInteger(usage.completion_tokens) : null;
  const totalTokens = isRecord(usage) ? nonNegativeInteger(usage.total_tokens) : null;
  if (
    promptTokens === null ||
    completionTokens === null ||
    totalTokens === null ||
    totalTokens !== promptTokens + completionTokens
  ) {
    fail(check, "invalid_usage");
  }
  return { requestId, usage: { promptTokens, completionTokens, totalTokens } };
}

function validateCompletionStream(body, check) {
  let sawAssistantRole = false;
  let sawContent = false;
  let sawDone = false;

  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") {
      sawDone = true;
      continue;
    }
    if (!data || sawDone) fail(check, "invalid_sse_sequence");
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      fail(check, "invalid_sse_json");
    }
    const choice = isRecord(payload) && Array.isArray(payload.choices) ? payload.choices[0] : null;
    const delta = isRecord(choice) && isRecord(choice.delta) ? choice.delta : null;
    if (isRecord(delta) && delta.role === "assistant") sawAssistantRole = true;
    if (isRecord(delta) && typeof delta.content === "string" && delta.content.length > 0) {
      sawContent = true;
    }
  }
  if (!sawAssistantRole || !sawContent || !sawDone) fail(check, "incomplete_sse_stream");
}

async function checkStreaming(fetcher, apiKey) {
  const check = "chat-stream";
  const response = await request(fetcher, check, "/v1/chat/completions", apiKey, {
    method: "POST",
    headers: { accept: "text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({
      model: PUBLIC_MODEL,
      messages: [{ role: "user", content: SMOKE_PROMPT }],
      max_tokens: 512,
      stream: true,
    }),
  });
  requireOk(response, check);
  requireContentType(response, check, "text/event-stream");
  const requestId = requiredRequestId(response, check);
  validateCompletionStream(await readBodyLimited(response, check), check);
  return { requestId };
}

async function timedCheck(name, operation, clock) {
  const startedAt = clock();
  const details = await operation();
  return {
    name,
    result: "pass",
    latencyMs: Math.max(0, Math.round(clock() - startedAt)),
    ...details,
  };
}

export async function runProductionSmoke(options = {}) {
  const fetcher = options.fetcher ?? fetch;
  const clock = options.clock ?? performance.now.bind(performance);
  const now = options.now ?? (() => new Date());
  const apiKey = typeof options.apiKey === "string"
    ? options.apiKey.trim()
    : (process.env.SOYAOS_PRODUCTION_SMOKE_API_KEY ?? "").trim();

  if (!apiKey) fail("configuration", "missing_api_key");
  if (!API_KEY_PATTERN.test(apiKey)) fail("configuration", "invalid_api_key_format");

  const checks = [];
  checks.push(await timedCheck("models", () => checkModels(fetcher, apiKey), clock));
  checks.push(
    await timedCheck("chat-non-stream", () => checkNonStreaming(fetcher, apiKey), clock),
  );
  checks.push(await timedCheck("chat-stream", () => checkStreaming(fetcher, apiKey), clock));

  return {
    environment: "production",
    checkedAt: now().toISOString(),
    result: "pass",
    checks,
  };
}

export function productionSmokeFailureReport(error, checkedAt = new Date().toISOString()) {
  const failure = error instanceof ProductionSmokeFailure ? error : null;
  return {
    environment: "production",
    checkedAt,
    result: "fail",
    check: failure?.check ?? "runner",
    code: failure?.code ?? "unexpected_failure",
    ...(failure?.status === null ? {} : { status: failure.status }),
    ...(failure?.requestId === null ? {} : { requestId: failure.requestId }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await runProductionSmoke(), null, 2));
  } catch (error) {
    console.error(JSON.stringify(productionSmokeFailureReport(error)));
    process.exitCode = 1;
  }
}
