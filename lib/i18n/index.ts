import { cookies, headers } from "next/headers";
import {
  dictionaries,
  locales,
  type Dictionary,
  type Locale,
} from "./dictionaries";

export const LOCALE_COOKIE = "locale";

function isLocale(value: string | undefined): value is Locale {
  return !!value && (locales as string[]).includes(value);
}

// Locale precedence: explicit cookie (set by the switcher), then the
// browser's Accept-Language, then German (the project's home market).
export async function getLocale(): Promise<Locale> {
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookie)) return cookie;
  const acceptLanguage = (await headers()).get("accept-language") ?? "";
  for (const part of acceptLanguage.split(",")) {
    const lang = part.split(";")[0]?.trim().slice(0, 2).toLowerCase();
    if (isLocale(lang)) return lang;
  }
  return "de";
}

export async function getDictionary(): Promise<Dictionary> {
  return dictionaries[await getLocale()];
}

export type { Dictionary, Locale };
