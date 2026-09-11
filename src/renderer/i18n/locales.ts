/**
 * Supported UI languages. Pure data + pure matching logic, deliberately free of any Electron or
 * DOM dependency so `matchSupportedLocale` can be unit-tested the same way window-bounds.ts is:
 * imported directly by a Node selftest with no app to boot.
 */

export type LocaleCode =
  | 'en'
  | 'es'
  | 'ru'
  | 'be'
  | 'ua'
  | 'pl'
  | 'de'
  | 'pt'
  | 'zh'
  | 'ko'
  | 'ja'
  | 'tr';

export const DEFAULT_LOCALE: LocaleCode = 'en';

/** Ordered for the Settings language picker; native name is what a reader of that language expects to see. */
export const SUPPORTED_LOCALES: { code: LocaleCode; nativeName: string }[] = [
  { code: 'en', nativeName: 'English' },
  { code: 'es', nativeName: 'Español' },
  { code: 'de', nativeName: 'Deutsch' },
  { code: 'pt', nativeName: 'Português' },
  { code: 'pl', nativeName: 'Polski' },
  { code: 'tr', nativeName: 'Türkçe' },
  { code: 'ru', nativeName: 'Русский' },
  { code: 'be', nativeName: 'Беларуская' },
  { code: 'ua', nativeName: 'Українська' },
  { code: 'zh', nativeName: '中文' },
  { code: 'ja', nativeName: '日本語' },
  { code: 'ko', nativeName: '한국어' },
];

const SUPPORTED_CODES = new Set<string>(SUPPORTED_LOCALES.map((l) => l.code));

export const isSupportedLocale = (value: unknown): value is LocaleCode =>
  typeof value === 'string' && SUPPORTED_CODES.has(value);

/**
 * Maps a BCP-47-ish OS locale string (`en-US`, `pt-BR`, `zh-Hans-CN`, `nb-NO`...) onto one of the
 * twelve supported languages, using only the primary subtag. Anything unmapped -- including an
 * empty string, garbage, or a language we do not ship -- falls back to English, never throws.
 */
export const matchSupportedLocale = (osLocale: unknown): LocaleCode => {
  if (typeof osLocale !== 'string' || !osLocale) return DEFAULT_LOCALE;
  const primary = osLocale.toLowerCase().split(/[-_]/)[0];
  if (primary === 'uk') return 'ua';
  return isSupportedLocale(primary) ? primary : DEFAULT_LOCALE;
};
