import type { APIRoute } from "astro";
import { llmsResponse } from "../lib/discovery";

export const GET: APIRoute = ({ url }) => llmsResponse(url.hostname);
