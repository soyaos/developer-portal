import type { APIRoute } from "astro";
import { controlContext, controlError, json } from "../../../lib/control-route";
import { ensureTenant, getUsage } from "../../../lib/control-plane";

export const prerender = false;

export const GET: APIRoute = async (context) => {
  try {
    const { db, user } = controlContext(context);
    const tenant = await ensureTenant(db, user);
    return json(await getUsage(db, tenant.id));
  } catch (error) {
    return controlError(error);
  }
};
