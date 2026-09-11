import { en, type TranslationKey } from './dictionaries/en.js';
import { es } from './dictionaries/es.js';
import { de } from './dictionaries/de.js';
import { pt } from './dictionaries/pt.js';
import { pl } from './dictionaries/pl.js';
import { tr } from './dictionaries/tr.js';
import { ru } from './dictionaries/ru.js';
import { be } from './dictionaries/be.js';
import { ua } from './dictionaries/ua.js';
import { zh } from './dictionaries/zh.js';
import { ja } from './dictionaries/ja.js';
import { ko } from './dictionaries/ko.js';
import { DEFAULT_LOCALE, isSupportedLocale, type LocaleCode } from './locales.js';

export type { LocaleCode, TranslationKey };
export { SUPPORTED_LOCALES, DEFAULT_LOCALE, matchSupportedLocale, isSupportedLocale } from './locales.js';

const DICTIONARIES: Record<LocaleCode, Record<TranslationKey, string>> = {
  en,
  es,
  de,
  pt,
  pl,
  tr,
  ru,
  be,
  ua,
  zh,
  ja,
  ko,
};

/**
 * Maps our internal locale codes to valid BCP-47 language tags for the DOM `lang` attribute.
 * `ua` is not a valid BCP-47 tag (the real tag for Ukrainian is `uk`); this ensures that
 * Chromium's native form controls (date/time pickers) recognize the language and localize accordingly.
 */
const BCP47_OVERRIDES: Partial<Record<LocaleCode, string>> = {
  ua: 'uk',
};

let activeLocale: LocaleCode = DEFAULT_LOCALE;

/**
 * Subscribers that must re-read `t()` when the language changes but are *not* reachable
 * through `applyStaticTranslations` -- i.e. text baked into DOM that JavaScript generates
 * (the custom date-picker trigger label, the Quick Add list/priority value labels) or text
 * that another module overwrites *after* `setLocale` has run (the add-task input placeholder,
 * which `renderShortcutHints()` rewrites to append the keyboard hint). Without this, that
 * content keeps whatever language was active when it was first built -- English, because the
 * composer and pickers are constructed in `init()` before `loadSettings()` calls `setLocale`.
 */
const localeChangeListeners = new Set<() => void>();

/**
 * Registers `listener` to run on every `setLocale` (including the first real one at boot).
 * Returns an unsubscribe function; callers that can be torn down (date pickers) must use it.
 */
export const onLocaleChange = (listener: () => void): (() => void) => {
  localeChangeListeners.add(listener);
  return () => localeChangeListeners.delete(listener);
};

export const getLocale = (): LocaleCode => activeLocale;

/** Looks up `key` in the active dictionary, falling back to English so a gap never surfaces a raw key. */
export const t = (key: TranslationKey): string => DICTIONARIES[activeLocale][key] ?? en[key] ?? key;

/**
 * Walks `root` for `data-i18n` (textContent), `data-i18n-placeholder`, `data-i18n-aria-label`,
 * `data-i18n-title` and `data-i18n-value` (for a <select>'s options, matched by their own
 * `data-i18n` on the <option>) attributes and applies the active dictionary. Safe to call
 * repeatedly -- e.g. once at startup and again every time the user changes the language.
 */
export const applyStaticTranslations = (root: ParentNode = document): void => {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key && (key in en)) el.textContent = t(key as TranslationKey);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key && key in en) el.setAttribute('placeholder', t(key as TranslationKey));
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria-label');
    if (key && key in en) el.setAttribute('aria-label', t(key as TranslationKey));
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key && key in en) el.setAttribute('title', t(key as TranslationKey));
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => {
    const key = el.getAttribute('data-i18n-html');
    if (key && key in en) el.innerHTML = t(key as TranslationKey);
  });
};

/** Swaps the active dictionary and immediately re-paints every tagged element under `document`. */
export const setLocale = (locale: LocaleCode): void => {
  activeLocale = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
  // Map internal locale codes to valid BCP-47 tags for the DOM. All current codes are valid BCP-47
  // except 'ua', which must become 'uk' for native form controls to localize correctly.
  document.documentElement.lang = BCP47_OVERRIDES[activeLocale] ?? activeLocale;
  applyStaticTranslations(document);
  // JS-generated / post-translated text (see localeChangeListeners doc above) re-reads t() here.
  localeChangeListeners.forEach((listener) => listener());
};
