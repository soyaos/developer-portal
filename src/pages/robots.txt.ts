import type { APIRoute } from "astro";
import { robotsResponse } from "../lib/discovery";

export const GET: APIRoute = ({ url }) => robotsResponse(url.hostname);
