import type { APIRoute } from "astro";
import { controlContext, controlError, json } from "../../../../lib/control-route";
import { createApiKey, ensureTenant, listApiKeys } from "../../../../lib/control-plane";

export const prerender = false;

export const GET: APIRoute = async (context) => {
  try {
    const { db, user } = controlContext(context);
    const tenant = await ensureTenant(db, user);
    return json({ keys: await listApiKeys(db, tenant.id) });
  } catch (error) {
    return controlError(error);
  }
};

export const POST: APIRoute = async (context) => {
  try {
    const { db, env, user } = controlContext(context);
    const contentType = context.request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      return json(
        { error: { code: "unsupported_media_type", message: "Expected application/json." } },
        { status: 415 },
      );
    }
    const body: unknown = await context.request.json();
    const name =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as { name?: unknown }).name
        : null;
    if (typeof name !== "string") {
      return json(
        { error: { code: "invalid_request", message: "A key name is required." } },
        { status: 400 },
      );
    }
    const tenant = await ensureTenant(db, user);
    const key = await createApiKey(db, tenant.id, name, env.API_KEY_PEPPER?.trim() ?? "");
    return json({ key }, { status: 201 });
  } catch (error) {
    return controlError(error);
  }
};
