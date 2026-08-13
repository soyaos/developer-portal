import { describe, expect, it } from "vitest";
import {
  createSession,
  getSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  sealSession,
  setSession,
  unsealSession,
} from "../src/lib/session";
import { MemoryCookies } from "./helpers";

const SECRET = "session-secret-with-at-least-thirty-two-bytes-123456";
const NOW = Date.UTC(2026, 7, 12, 12, 0, 0);

describe("encrypted session cookie", () => {
  const session = createSession(
    {
      id: 12345,
      login: "octocat",
      name: "The Octocat",
      avatarUrl: "https://avatars.githubusercontent.com/u/12345",
    },
    NOW,
  );

  it("round-trips through an opaque AES-GCM envelope", async () => {
    const sealed = await sealSession(session, SECRET);
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain("octocat");
    await expect(unsealSession(sealed, SECRET, NOW + 1)).resolves.toEqual(session);
  });

  it("rejects tampering, a wrong key, and malformed values", async () => {
    const sealed = await sealSession(session, SECRET);
    const last = sealed.at(-1) === "A" ? "B" : "A";
    await expect(unsealSession(`${sealed.slice(0, -1)}${last}`, SECRET, NOW + 1)).resolves.toBeNull();
    await expect(unsealSession(sealed, `${SECRET}-different`, NOW + 1)).resolves.toBeNull();
    await expect(unsealSession("not-a-session", SECRET, NOW + 1)).resolves.toBeNull();
  });

  it("rejects expired sessions", async () => {
    const sealed = await sealSession(session, SECRET);
    await expect(
      unsealSession(sealed, SECRET, NOW + SESSION_MAX_AGE_SECONDS * 1000 + 1),
    ).resolves.toBeNull();
  });

  it("requires a high-entropy secret", async () => {
    await expect(sealSession(session, "too-short")).rejects.toThrow(/at least 32 bytes/);
  });

  it("sets all required __Host cookie attributes", async () => {
    const cookies = new MemoryCookies();
    await setSession(cookies.asAstroCookies(), session, SECRET);
    const write = cookies.writes.get(SESSION_COOKIE);
    expect(write?.options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    await expect(getSession(cookies.asAstroCookies(), SECRET, NOW + 1)).resolves.toEqual(session);
  });
});
