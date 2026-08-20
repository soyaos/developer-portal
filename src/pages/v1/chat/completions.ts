import type { APIRoute } from "astro";
import { handleChatCompletionsRequest, handleInferenceOptions } from "../../../lib/inference-api";
import { runtimeEnv } from "../../../lib/runtime-env";

export const prerender = false;

export const POST: APIRoute = ({ request }) =>
  handleChatCompletionsRequest(request, runtimeEnv());

export const OPTIONS: APIRoute = ({ request }) =>
  handleInferenceOptions(request);
