"use client";

import { createContext, useContext } from "react";
import { DICTIONARIES, DEFAULT_LOCALE, type Dictionary, type Locale } from "./dictionaries";

const I18nContext = createContext<Dictionary>(DICTIONARIES[DEFAULT_LOCALE]);

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <I18nContext.Provider value={DICTIONARIES[locale]}>{children}</I18nContext.Provider>;
}

export function useDictionary(): Dictionary {
  return useContext(I18nContext);
}
