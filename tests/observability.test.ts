import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInferenceHealthEvent,
  emitInferenceHealth,
  emitMetadataWriteFailure,
} from "../src/lib/observability";

const healthInput = {
  requestId: "req_0123456789abcdef",
  model: "soya:starter",
  stream: false,
  statusCode: 200,
  outcome: "success" as const,
  latencyMs: 123,
  promptTokens: 7,
  completionTokens: 2,
};

afterEach(() => vi.restoreAllMocks());

describe("production inference observability", () => {
  it("builds a fixed, body-free health event", () => {
    const event = createInferenceHealthEvent(healthInput);

    expect(event).toEqual({
      event: "soyaos.inference.completed",
      requestId: "req_0123456789abcdef",
      model: "soya:starter",
      stream: false,
      statusCode: 200,
      outcome: "success",
      errorCode: null,
      latencyMs: 123,
      promptTokens: 7,
      completionTokens: 2,
      totalTokens: 9,
    });
    const serialized = JSON.stringify(event);
    for (const forbidden of [
      "tenant_github_",
      "sk-soya-",
      "authorization",
      "messages",
      "Reply with pong",
      "completion content",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("uses warning and error severity for 429 and 5xx events", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failure = vi.spyOn(console, "error").mockImplementation(() => undefined);

    emitInferenceHealth({
      ...healthInput,
      statusCode: 429,
      outcome: "rejected",
      errorCode: "rate_limit",
    });
    emitInferenceHealth({
      ...healthInput,
      statusCode: 503,
      outcome: "error",
      errorCode: "upstream_unavailable",
    });

    expect(warning).toHaveBeenCalledWith(
      expect.objectContaining({ event: "soyaos.inference.completed", statusCode: 429 }),
    );
    expect(failure).toHaveBeenCalledWith(
      expect.objectContaining({ event: "soyaos.inference.completed", statusCode: 503 }),
    );
  });

  it("records metadata failures without the underlying exception", () => {
    const failure = vi.spyOn(console, "error").mockImplementation(() => undefined);

    emitMetadataWriteFailure("req_safe", "stream_success");

    expect(failure).toHaveBeenCalledWith({
      event: "soyaos.inference.metadata_write_failed",
      requestId: "req_safe",
      phase: "stream_success",
      errorCode: "metadata_write_failed",
    });
  });
});
