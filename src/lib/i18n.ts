import en from "../locales/en.json";
import zhHant from "../locales/zh-hant.json";
import zh from "../locales/zh.json";

export const LOCALES = ["zh", "zh-hant", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export type PortalDictionary = typeof en;

export const DEFAULT_LOCALE: Locale = "zh";
export const UNSUPPORTED_LOCALE_SEGMENTS = new Set([
  "zh-cn",
  "zh-hans",
  "zh-tw",
  "zh-hk",
  "en-us",
]);

export const LOCALE_META: Record<Locale, {
  htmlLang: string;
  ogLocale: string;
  nativeName: string;
}> = {
  zh: { htmlLang: "zh-CN", ogLocale: "zh_CN", nativeName: "简体中文" },
  "zh-hant": { htmlLang: "zh-Hant", ogLocale: "zh_TW", nativeName: "繁體中文" },
  en: { htmlLang: "en-US", ogLocale: "en_US", nativeName: "English" },
};

const dictionaries: Record<Locale, PortalDictionary> = {
  en,
  zh: zh as PortalDictionary,
  "zh-hant": zhHant as PortalDictionary,
};

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function getDictionary(locale: Locale): PortalDictionary {
  return dictionaries[locale];
}

export function localeFromPath(pathname: string): Locale | null {
  const segment = pathname.split("/")[1] ?? "";
  return isLocale(segment) ? segment : null;
}

export function stripLocale(pathname: string, locale: Locale): string {
  const stripped = pathname.slice(locale.length + 1);
  return stripped || "/";
}

export function localizePath(locale: Locale, pathname: string): string {
  const current = localeFromPath(pathname);
  const unlocalized = current ? stripLocale(pathname, current) : pathname;
  return unlocalized === "/" ? `/${locale}` : `/${locale}${unlocalized}`;
}

export function negotiateLocale(header: string | null): Locale {
  const raw = header?.trim() ?? "";
  if (!raw || raw.split(",").every((part) => part.trim().startsWith("*"))) {
    return DEFAULT_LOCALE;
  }

  const preferences = raw
    .split(",")
    .map((part, index) => {
      const [tagPart, ...parameters] = part.trim().split(";");
      const qualityParameter = parameters.find((parameter) => parameter.trim().startsWith("q="));
      const quality = qualityParameter
        ? Number.parseFloat(qualityParameter.trim().slice(2))
        : 1;
      return {
        tag: tagPart.toLowerCase(),
        quality: Number.isFinite(quality) ? quality : 0,
        index,
      };
    })
    .filter(({ tag, quality }) => tag !== "*" && quality > 0)
    .sort((left, right) => right.quality - left.quality || left.index - right.index);

  for (const { tag } of preferences) {
    if (
      tag === "zh-hant" || tag.startsWith("zh-hant-") ||
      tag === "zh-tw" || tag.startsWith("zh-tw-") ||
      tag === "zh-hk" || tag.startsWith("zh-hk-") ||
      tag === "zh-mo" || tag.startsWith("zh-mo-")
    ) return "zh-hant";
    if (
      tag === "zh" || tag.startsWith("zh-hans-") ||
      tag === "zh-cn" || tag.startsWith("zh-cn-") ||
      tag === "zh-sg" || tag.startsWith("zh-sg-")
    ) return "zh";
    if (tag === "en" || tag.startsWith("en-")) return "en";
  }
  return "en";
}
