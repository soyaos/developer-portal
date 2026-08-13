import type { AstroCookies } from "astro";
import { resetTestEnv } from "./cloudflare-workers";

export interface CookieWrite {
  value: string;
  options: Record<string, unknown>;
}

export class MemoryCookies {
  readonly values = new Map<string, string>();
  readonly writes = new Map<string, CookieWrite>();
  readonly deletions = new Set<string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [name, value] of Object.entries(initial)) this.values.set(name, value);
  }

  get(name: string): { value: string } | undefined {
    const value = this.values.get(name);
    return value === undefined ? undefined : { value };
  }

  has(name: string): boolean {
    return this.values.has(name);
  }

  set(name: string, value: string, options: Record<string, unknown> = {}): void {
    this.values.set(name, value);
    this.writes.set(name, { value, options });
    this.deletions.delete(name);
  }

  delete(name: string): void {
    this.values.delete(name);
    this.deletions.add(name);
  }

  asAstroCookies(): AstroCookies {
    return this as unknown as AstroCookies;
  }
}

export function routeContext(
  rawUrl: string,
  cookies: MemoryCookies,
  env: PortalEnv,
): never {
  resetTestEnv(env);
  const url = new URL(rawUrl);
  return {
    cookies: cookies.asAstroCookies(),
    locals: { cfContext: {} as ExecutionContext, user: null },
    request: new Request(url),
    url,
  } as never;
}
