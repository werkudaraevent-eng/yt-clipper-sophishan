import { cookies, headers } from "next/headers";
import {
  DICTIONARIES,
  LOCALE_COOKIE,
  isLocale,
  localeFromAcceptLanguage,
  type Dictionary,
  type Locale,
} from "./dictionaries";

export async function getLocale(): Promise<Locale> {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  return localeFromAcceptLanguage((await headers()).get("accept-language"));
}

export async function getDictionary(): Promise<Dictionary> {
  return DICTIONARIES[await getLocale()];
}
