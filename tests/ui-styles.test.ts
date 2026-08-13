import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalStyles = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");
const loginPage = readFileSync(new URL("../src/pages/login.astro", import.meta.url), "utf8");

function themeHex(token: string): string {
  const match = globalStyles.match(new RegExp(`--color-${token}:\\s*(#[0-9a-f]{6})`, "i"));
  if (!match?.[1]) throw new Error(`Missing theme color: ${token}`);
  return match[1];
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255);
  if (!channels || channels.length !== 3) throw new Error(`Invalid color: ${hex}`);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("login button styles", () => {
  it("keeps link color resets inside Tailwind's base layer", () => {
    // Tailwind Preflight already resets links in @layer base. A duplicate
    // unlayered rule wins over text-soya-paper and makes the CTA text dark.
    expect(globalStyles).not.toMatch(/(?:^|\n)\s*a\s*\{[^}]*color:\s*inherit/);
  });

  it("uses a WCAG AA contrast pair for the GitHub CTA", () => {
    expect(loginPage).toContain("bg-soya-ink");
    expect(loginPage).toContain("text-soya-paper");
    expect(contrastRatio(themeHex("soya-paper"), themeHex("soya-ink"))).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});
