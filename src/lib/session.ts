import type { AstroCookies } from "astro";

export const SESSION_COOKIE = "__Host-soyaos_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

const SESSION_VERSION = "v1";
const SESSION_AAD = new TextEncoder().encode("soyaos-developer-portal:session:v1");

export interface Session {
  version: 1;
  githubId: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  issuedAt: number;
  expiresAt: number;
}

const COOKIE_SECURITY_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: true,
  path: "/",
};

const COOKIE_OPTIONS = {
  ...COOKIE_SECURITY_OPTIONS,
  maxAge: SESSION_MAX_AGE_SECONDS,
};

function assertSecret(secret: string): void {
  if (new TextEncoder().encode(secret).length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 bytes");
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid base64url");
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (encodeBase64Url(bytes) !== value) throw new Error("non-canonical base64url");
  return bytes;
}

async function sessionKey(secret: string): Promise<CryptoKey> {
  assertSecret(secret);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function isSession(value: unknown, now: number): value is Session {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const session = value as Partial<Session>;
  return (
    session.version === 1 &&
    Number.isSafeInteger(session.githubId) &&
    (session.githubId ?? 0) > 0 &&
    typeof session.login === "string" &&
    session.login.length > 0 &&
    (session.name === null || typeof session.name === "string") &&
    (session.avatarUrl === null || typeof session.avatarUrl === "string") &&
    Number.isSafeInteger(session.issuedAt) &&
    Number.isSafeInteger(session.expiresAt) &&
    (session.issuedAt ?? 0) <= now + 5 * 60 * 1000 &&
    (session.expiresAt ?? 0) > now &&
    (session.expiresAt ?? 0) - (session.issuedAt ?? 0) <= SESSION_MAX_AGE_SECONDS * 1000
  );
}

export function createSession(
  user: { id: number; login: string; name: string | null; avatarUrl: string | null },
  now = Date.now(),
): Session {
  return {
    version: 1,
    githubId: user.id,
    login: user.login,
    name: user.name,
    avatarUrl: user.avatarUrl,
    issuedAt: now,
    expiresAt: now + SESSION_MAX_AGE_SECONDS * 1000,
  };
}

export async function sealSession(session: Session, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(session));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: SESSION_AAD },
    await sessionKey(secret),
    plaintext,
  );
  return `${SESSION_VERSION}.${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(ciphertext))}`;
}

export async function unsealSession(
  value: string,
  secret: string,
  now = Date.now(),
): Promise<Session | null> {
  try {
    const [version, encodedIv, encodedCiphertext, extra] = value.split(".");
    if (version !== SESSION_VERSION || !encodedIv || !encodedCiphertext || extra) return null;
    const iv = decodeBase64Url(encodedIv);
    if (iv.length !== 12) return null;
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: SESSION_AAD },
      await sessionKey(secret),
      decodeBase64Url(encodedCiphertext),
    );
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
    return isSession(parsed, now) ? parsed : null;
  } catch {
    return null;
  }
}

export async function setSession(
  cookies: AstroCookies,
  session: Session,
  secret: string,
): Promise<void> {
  cookies.set(SESSION_COOKIE, await sealSession(session, secret), COOKIE_OPTIONS);
}

export async function getSession(
  cookies: AstroCookies,
  secret: string,
  now = Date.now(),
): Promise<Session | null> {
  const raw = cookies.get(SESSION_COOKIE)?.value;
  return raw ? unsealSession(raw, secret, now) : null;
}

export function clearSession(cookies: AstroCookies): void {
  // A __Host- cookie deletion must itself satisfy the prefix requirements.
  // Browsers ignore a clearing Set-Cookie header that omits Secure or Path=/.
  cookies.delete(SESSION_COOKIE, COOKIE_SECURITY_OPTIONS);
}
