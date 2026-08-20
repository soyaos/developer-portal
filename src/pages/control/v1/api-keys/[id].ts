import type { APIRoute } from "astro";
import { controlContext, controlError } from "../../../../lib/control-route";
import { ensureTenant, revokeApiKey } from "../../../../lib/control-plane";

export const prerender = false;

export const DELETE: APIRoute = async (context) => {
  try {
    const { db, user } = controlContext(context);
    const tenant = await ensureTenant(db, user);
    await revokeApiKey(db, tenant.id, context.params.id ?? "");
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return controlError(error);
  }
};
