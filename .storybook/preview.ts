import type { Decorator, Preview } from '@storybook/html-vite';

import '../styles.css';
import './preview.css';
import baseTokenCss from '../styles/tokens.css?raw';
import darkTokenCss from '../styles/themes.css?raw';

type ThemeName = 'light' | 'dark';
type TokenMap = Record<string, string>;

const parseTokens = (css: string, source: string): TokenMap => {
  const tokens = Object.fromEntries(
    [...css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)].map((match) => [
      match[1],
      match[2].trim(),
    ]),
  );

  if (Object.keys(tokens).length === 0) {
    throw new Error(`Storybook could not parse design tokens from ${source}.`);
  }

  return tokens;
};

const lightTokens = parseTokens(baseTokenCss, 'styles/tokens.css');
const darkOverrides = parseTokens(darkTokenCss, 'styles/themes.css');
const darkTokens = { ...lightTokens, ...darkOverrides };
const themeTokenNames = new Set([...Object.keys(lightTokens), ...Object.keys(darkTokens)]);

const applyTheme = (theme: ThemeName): void => {
  const root = document.documentElement;
  const tokens = theme === 'dark' ? darkTokens : lightTokens;

  themeTokenNames.forEach((name) => {
    const value = tokens[name];
    if (value === undefined) {
      root.style.removeProperty(name);
    } else {
      root.style.setProperty(name, value);
    }
  });

  root.dataset.adeoTheme = theme;
  root.style.colorScheme = theme;
};

const withAdeoTheme: Decorator = (Story, context) => {
  const theme: ThemeName = context.globals.theme === 'dark' ? 'dark' : 'light';
  applyTheme(theme);
  return Story();
};

const preview: Preview = {
  decorators: [withAdeoTheme],
  globalTypes: {
    theme: {
      description: 'Adeo color theme',
      toolbar: {
        icon: 'mirror',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: 'light',
    viewport: { value: 'adeo1440', isRotated: false },
  },
  parameters: {
    layout: 'fullscreen',
    viewport: {
      options: {
        adeo1440: {
          name: 'Desktop 1440',
          styles: { width: '1440px', height: '900px' },
          type: 'desktop',
        },
        adeo1024: {
          name: 'Desktop 1024',
          styles: { width: '1024px', height: '768px' },
          type: 'desktop',
        },
        adeo768: {
          name: 'Tablet 768',
          styles: { width: '768px', height: '1024px' },
          type: 'tablet',
        },
        adeo390: {
          name: 'Mobile 390',
          styles: { width: '390px', height: '844px' },
          type: 'mobile',
        },
      },
    },
  },
};

export default preview;
