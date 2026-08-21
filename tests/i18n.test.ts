import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isLocale,
  localizePath,
  localeFromPath,
  negotiateLocale,
  stripLocale,
} from "../src/lib/i18n";

function dictionary(locale: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url), "utf8"),
  );
}

function leafPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => leafPaths(item, `${prefix}.${index}`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      leafPaths(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [prefix];
}

describe("Portal locale contract", () => {
  it("keeps all locale dictionaries structurally identical", () => {
    const reference = leafPaths(dictionary("en")).sort();
    expect(leafPaths(dictionary("zh")).sort()).toEqual(reference);
    expect(leafPaths(dictionary("zh-hant")).sort()).toEqual(reference);
  });

  it("recognizes only the public URL locale codes", () => {
    expect(isLocale("zh")).toBe(true);
    expect(isLocale("zh-hant")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("zh-CN")).toBe(false);
  });

  it("maps Chinese scripts and regions before generic Chinese", () => {
    expect(negotiateLocale("zh-TW,zh;q=0.9,en;q=0.8")).toBe("zh-hant");
    expect(negotiateLocale("zh-Hant-HK,en;q=0.8")).toBe("zh-hant");
    expect(negotiateLocale("zh-CN,en;q=0.8")).toBe("zh");
    expect(negotiateLocale("en-GB,zh;q=0.8")).toBe("en");
  });

  it("uses the two specified fallback cases", () => {
    expect(negotiateLocale(null)).toBe("zh");
    expect(negotiateLocale("   ")).toBe("zh");
    expect(negotiateLocale("*;q=0.8")).toBe("zh");
    expect(negotiateLocale("fr-FR,de;q=0.9")).toBe("en");
  });

  it("preserves the non-locale route when switching locale", () => {
    expect(localeFromPath("/zh-hant/usage")).toBe("zh-hant");
    expect(stripLocale("/zh-hant/usage", "zh-hant")).toBe("/usage");
    expect(localizePath("en", "/zh-hant/usage")).toBe("/en/usage");
    expect(localizePath("zh", "/")).toBe("/zh");
  });
});
