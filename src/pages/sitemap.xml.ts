import type { APIRoute } from "astro";
import { sitemapResponse } from "../lib/discovery";

export const GET: APIRoute = ({ url }) => sitemapResponse(url.hostname);
