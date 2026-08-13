export const env: PortalEnv = {};

export function resetTestEnv(values: PortalEnv): void {
  for (const key of Object.keys(env) as (keyof PortalEnv)[]) delete env[key];
  Object.assign(env, values);
}
