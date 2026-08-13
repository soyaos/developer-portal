import type { APIRoute } from "astro";
import { clearSession } from "../../lib/session";

export const prerender = false;

export const POST: APIRoute = async ({ cookies }) => {
  clearSession(cookies);
  return new Response(null, {
    status: 303,
    headers: {
      "cache-control": "no-store",
      location: "/login",
    },
  });
};
