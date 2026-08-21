export type InferenceOutcome = "success" | "rejected" | "error";

export type MetadataWritePhase =
  | "completion_success"
  | "completion_error"
  | "stream_success"
  | "stream_error"
  | "stream_cancelled";

export interface InferenceHealthInput {
  requestId: string;
  model: string;
  stream: boolean | null;
  statusCode: number;
  outcome: InferenceOutcome;
  errorCode?: string | null;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
}

function safeInteger(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function createInferenceHealthEvent(input: InferenceHealthInput) {
  const promptTokens = safeInteger(input.promptTokens);
  const completionTokens = safeInteger(input.completionTokens);
  return {
    event: "soyaos.inference.completed" as const,
    requestId: input.requestId,
    model: input.model,
    stream: input.stream,
    statusCode: input.statusCode,
    outcome: input.outcome,
    errorCode: input.errorCode ?? null,
    latencyMs: safeInteger(input.latencyMs),
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

export function emitInferenceHealth(input: InferenceHealthInput): void {
  const event = createInferenceHealthEvent(input);
  if (input.statusCode >= 500) {
    console.error(event);
  } else if (input.statusCode === 429) {
    console.warn(event);
  } else {
    console.log(event);
  }
}

export function emitMetadataWriteFailure(
  requestId: string,
  phase: MetadataWritePhase,
): void {
  console.error({
    event: "soyaos.inference.metadata_write_failed",
    requestId,
    phase,
    errorCode: "metadata_write_failed",
  });
}
