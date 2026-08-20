import type { APIRoute } from "astro";
import { handleInferenceOptions, handleModelsRequest } from "../../lib/inference-api";
import { runtimeEnv } from "../../lib/runtime-env";

export const prerender = false;

export const GET: APIRoute = ({ request }) =>
  handleModelsRequest(request, runtimeEnv());

export const OPTIONS: APIRoute = ({ request }) =>
  handleInferenceOptions(request);
