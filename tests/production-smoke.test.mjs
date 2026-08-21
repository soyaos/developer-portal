import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  productionSmokeFailureReport,
  runProductionSmoke,
} from "../scripts/production-smoke.mjs";

const TEST_KEY = `sk-soya-${"a".repeat(12)}.${"b".repeat(43)}`;
const FIXED_PROMPT = "Reply with exactly one lowercase word: ready";
const MODEL_OUTPUT = "MODEL_OUTPUT_MUST_NOT_BE_LOGGED";
const ERROR_BODY = "ERROR_BODY_MUST_NOT_BE_LOGGED";

function jsonResponse(payload, requestId, status = 200) {
  return Response.json(payload, {
    status,
    headers: { "x-request-id": requestId },
  });
}

function streamResponse(requestId) {
  return new Response(
    [
      'data: {"choices":[{"delta":{"role":"assistant"}}]}',
      `data: {"choices":[{"delta":{"content":"${MODEL_OUTPUT}"}}]}`,
      "data: [DONE]",
      "",
    ].join("\n\n"),
    {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "x-request-id": requestId,
      },
    },
  );
}

function smokeFetch(overrides = {}) {
  const responses = {
    "GET https://api.soyaos.ai/v1/models": jsonResponse(
      { object: "list", data: [{ id: "soya:starter", object: "model" }] },
      `req_${"1".repeat(32)}`,
    ),
    ...overrides,
  };
  const requests = [];
  const fetcher = vi.fn(async (input, init = {}) => {
    requests.push({ input: String(input), init });
    const postCount = requests.filter((request) => request.init.method === "POST").length;
    const key = `${init.method ?? "GET"}${init.method === "POST" ? `-${postCount}` : ""} ${String(input)}`;
    const requestId = `req_${(postCount + 1).toString(16).repeat(32)}`;
    const defaultPostResponse = postCount % 2 === 1
      ? jsonResponse(
        {
          object: "chat.completion",
          model: "soya:starter",
          choices: [{ message: { role: "assistant", content: MODEL_OUTPUT } }],
          usage: { prompt_tokens: 8, completion_tokens: 1, total_tokens: 9 },
        },
        requestId,
      )
      : streamResponse(requestId);
    const response = responses[key] ?? (init.method === "POST" ? defaultPostResponse : null);
    if (!response) throw new Error(`unexpected request ${key}`);
    return response.clone();
  });
  return { fetcher, requests };
}

describe("one-shot production inference smoke", () => {
  it("validates models, non-streaming usage and the SSE completion contract", async () => {
    const { fetcher, requests } = smokeFetch();
    const result = await runProductionSmoke({
      apiKey: TEST_KEY,
      fetcher,
      clock: (() => {
        let value = 0;
        return () => value += 7;
      })(),
      now: () => new Date("2026-08-20T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      environment: "production",
      result: "pass",
      mode: "full",
      rounds: 1,
      expectedChatRequests: 2,
      passedChatRequests: 2,
      checks: [
        { name: "models", result: "pass", requestId: `req_${"1".repeat(32)}` },
        {
          name: "chat-non-stream",
          result: "pass",
          requestId: `req_${"2".repeat(32)}`,
          usage: { promptTokens: 8, completionTokens: 1, totalTokens: 9 },
        },
        { name: "chat-stream", result: "pass", requestId: `req_${"3".repeat(32)}` },
      ],
    });
    expect(requests).toHaveLength(3);
    expect(requests.every(({ init }) => init.headers.authorization === `Bearer ${TEST_KEY}`)).toBe(
      true,
    );
    expect(requests.every(({ init }) => init.signal instanceof AbortSignal)).toBe(true);
    const postBodies = requests
      .filter(({ init }) => init.method === "POST")
      .map(({ init }) => JSON.parse(init.body));
    expect(postBodies).toEqual([
      expect.objectContaining({ model: "soya:starter", max_tokens: 512, stream: false }),
      expect.objectContaining({ model: "soya:starter", max_tokens: 512, stream: true }),
    ]);

    const serializedResult = JSON.stringify(result);
    expect(serializedResult).not.toContain(TEST_KEY);
    expect(serializedResult).not.toContain(FIXED_PROMPT);
    expect(serializedResult).not.toContain(MODEL_OUTPUT);
  });

  it("runs five bounded rounds as exactly ten sequential Chat requests", async () => {
    const { fetcher, requests } = smokeFetch();
    const result = await runProductionSmoke({
      apiKey: TEST_KEY,
      fetcher,
      rounds: 5,
      now: () => new Date("2026-08-20T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      mode: "full",
      rounds: 5,
      expectedChatRequests: 10,
      passedChatRequests: 10,
      result: "pass",
    });
    expect(result.checks).toHaveLength(11);
    expect(result.checks.slice(1).map(({ name, round }) => ({ name, round }))).toEqual(
      Array.from({ length: 5 }, (_, index) => [
        { name: "chat-non-stream", round: index + 1 },
        { name: "chat-stream", round: index + 1 },
      ]).flat(),
    );
    expect(requests).toHaveLength(11);
    expect(requests.filter(({ init }) => init.method === "POST")).toHaveLength(10);
    expect(JSON.stringify(result)).not.toContain(MODEL_OUTPUT);
  });

  it("supports a read-only models mode for revoked-key verification", async () => {
    const { fetcher, requests } = smokeFetch();
    const result = await runProductionSmoke({
      apiKey: TEST_KEY,
      fetcher,
      mode: "models-only",
      rounds: 1,
    });

    expect(result).toMatchObject({
      mode: "models-only",
      rounds: 1,
      expectedChatRequests: 0,
      passedChatRequests: 0,
      result: "pass",
    });
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].name).toBe("models");
    expect(requests).toHaveLength(1);
    expect(requests[0].init.method).toBeUndefined();
  });

  it.each([0, 6, 2.5, "05", "many"])(
    "rejects invalid rounds %s before networking",
    async (rounds) => {
      const fetcher = vi.fn();
      const error = await runProductionSmoke({ apiKey: TEST_KEY, fetcher, rounds }).catch(
        (cause) => cause,
      );
      expect(productionSmokeFailureReport(error)).toMatchObject({
        check: "configuration",
        code: "invalid_rounds",
      });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("stops on the first failed Chat request without retrying or starting the next check", async () => {
    const { fetcher, requests } = smokeFetch({
      "POST-3 https://api.soyaos.ai/v1/chat/completions": new Response(ERROR_BODY, {
        status: 503,
        headers: { "x-request-id": `req_${"4".repeat(32)}` },
      }),
    });
    const error = await runProductionSmoke({ apiKey: TEST_KEY, fetcher, rounds: 5 }).catch(
      (cause) => cause,
    );

    expect(productionSmokeFailureReport(error)).toMatchObject({
      check: "chat-non-stream",
      code: "unexpected_status",
      status: 503,
      round: 2,
    });
    expect(requests).toHaveLength(4);
    expect(requests.filter(({ init }) => init.method === "POST")).toHaveLength(3);
  });

  it("fails before networking when the production API key is absent", async () => {
    const fetcher = vi.fn();
    const error = await runProductionSmoke({ apiKey: "", fetcher }).catch((cause) => cause);
    expect(productionSmokeFailureReport(error, "2026-08-20T00:00:00.000Z")).toMatchObject({
      result: "fail",
      check: "configuration",
      code: "missing_api_key",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports only a fixed error code when an upstream body contains sensitive text", async () => {
    const upstreamResponse = new Response(ERROR_BODY, {
      status: 500,
      headers: {
        "content-type": "text/plain",
        "x-request-id": `req_${"4".repeat(32)}`,
      },
    });
    const fetcher = vi.fn(async () => upstreamResponse);
    const error = await runProductionSmoke({ apiKey: TEST_KEY, fetcher }).catch((cause) => cause);
    const report = productionSmokeFailureReport(error, "2026-08-20T00:00:00.000Z");
    expect(report).toMatchObject({
      result: "fail",
      check: "models",
      code: "unexpected_status",
      status: 500,
      requestId: `req_${"4".repeat(32)}`,
    });
    const serializedReport = JSON.stringify(report);
    expect(serializedReport).not.toContain(TEST_KEY);
    expect(serializedReport).not.toContain(ERROR_BODY);
    expect(upstreamResponse.bodyUsed).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("omits an invalid upstream request ID from the fixed failure report", async () => {
    const { fetcher } = smokeFetch({
      "GET https://api.soyaos.ai/v1/models": new Response(ERROR_BODY, {
        status: 502,
        headers: {
          "content-type": "text/plain",
          "x-request-id": "unsafe-control-value",
        },
      }),
    });
    const error = await runProductionSmoke({ apiKey: TEST_KEY, fetcher }).catch((cause) => cause);
    const report = productionSmokeFailureReport(error, "2026-08-20T00:00:00.000Z");
    expect(report).toMatchObject({
      result: "fail",
      check: "models",
      code: "unexpected_status",
      status: 502,
    });
    expect(report).not.toHaveProperty("requestId");
    expect(JSON.stringify(report)).not.toContain("unsafe-control-value");
  });

  it("rejects inconsistent token usage without exposing the completion body", async () => {
    const { fetcher } = smokeFetch({
      "POST-1 https://api.soyaos.ai/v1/chat/completions": jsonResponse(
        {
          object: "chat.completion",
          model: "soya:starter",
          choices: [{ message: { role: "assistant", content: MODEL_OUTPUT } }],
          usage: { prompt_tokens: 8, completion_tokens: 1, total_tokens: 99 },
        },
        `req_${"2".repeat(32)}`,
      ),
    });
    const error = await runProductionSmoke({ apiKey: TEST_KEY, fetcher }).catch((cause) => cause);
    const report = productionSmokeFailureReport(error, "2026-08-20T00:00:00.000Z");
    expect(report).toMatchObject({ check: "chat-non-stream", code: "invalid_usage" });
    expect(JSON.stringify(report)).not.toContain(MODEL_OUTPUT);
  });
});

describe("production smoke workflow", () => {
  it("is manual-only and reads its key from the isolated GitHub Environment", async () => {
    const workflow = await readFile(
      new URL("../.github/workflows/production-smoke.yml", import.meta.url),
      "utf8",
    );
    expect(workflow).toMatch(/workflow_dispatch:/);
    expect(workflow).toMatch(/environment: production-smoke/);
    expect(workflow).toContain("secrets.SOYAOS_PRODUCTION_SMOKE_API_KEY");
    expect(workflow).toContain("SOYAOS_PRODUCTION_SMOKE_MODE: ${{ inputs.mode }}");
    expect(workflow).toContain("SOYAOS_PRODUCTION_SMOKE_ROUNDS: ${{ inputs.rounds }}");
    expect(workflow).toMatch(/options:\s+\- full\s+\- models-only/);
    expect(workflow).toMatch(/options:\s+\- "1"[\s\S]+\- "5"/);
    expect(workflow).not.toMatch(/^\s+schedule:/m);
    expect(workflow).not.toMatch(/^\s+push:/m);
    expect(workflow).not.toMatch(/^\s+pull_request:/m);
  });
});
