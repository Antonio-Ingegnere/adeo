import type { Meta, StoryObj } from '@storybook/html-vite';

import './design-system-smoke.css';

const meta: Meta = {
  title: 'Foundations/Design system smoke',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A framework-free smoke test for Adeo production tokens across themes and viewport presets.',
      },
    },
  },
};

export default meta;
type Story = StoryObj;

const createTokenSwatch = (label: string, token: string): HTMLElement => {
  const swatch = document.createElement('li');
  swatch.className = 'design-smoke__swatch';
  swatch.innerHTML = `
    <span class="design-smoke__color" style="background: var(${token})"></span>
    <span>${label}</span>
    <code>${token}</code>
  `;
  return swatch;
};

export const Tokens: Story = {
  render: () => {
    const theme = document.documentElement.dataset.adeoTheme ?? 'light';
    const page = document.createElement('main');
    page.className = 'design-smoke';
    page.dataset.storybookSmoke = 'ready';
    page.innerHTML = `
      <header class="design-smoke__header">
        <div>
          <p class="design-smoke__eyebrow">Adeo foundations</p>
          <h1>Production design tokens</h1>
          <p class="design-smoke__lede">
            A compact rendering check for surfaces, typography, status, spacing, and radius.
          </p>
        </div>
        <span class="design-smoke__theme" data-testid="active-theme">${theme} theme</span>
      </header>

      <section class="design-smoke__grid" aria-label="Design token samples">
        <article class="design-smoke__card">
          <h2>Surfaces</h2>
          <ul class="design-smoke__swatches" data-testid="token-swatches"></ul>
        </article>

        <article class="design-smoke__card">
          <h2>Type scale</h2>
          <div class="design-smoke__type-scale">
            <strong class="design-smoke__type-xl">Plan the next useful step</strong>
            <span class="design-smoke__type-l">Keep priorities visible and calm.</span>
            <span class="design-smoke__type-m">Tomorrow · Personal</span>
            <code>⌘ K</code>
          </div>
        </article>

        <article class="design-smoke__card">
          <h2>Status and priority</h2>
          <div class="design-smoke__statuses">
            <span class="design-smoke__status design-smoke__status--success">Complete</span>
            <span class="design-smoke__status design-smoke__status--danger">Blocked</span>
            <span class="design-smoke__status design-smoke__status--priority">High priority</span>
          </div>
        </article>

        <article class="design-smoke__card">
          <h2>Spacing and radius</h2>
          <div class="design-smoke__rhythm">
            <span class="design-smoke__bar design-smoke__bar--8">8</span>
            <span class="design-smoke__bar design-smoke__bar--16">16</span>
            <span class="design-smoke__bar design-smoke__bar--24">24</span>
            <span class="design-smoke__bar design-smoke__bar--32">32</span>
          </div>
        </article>
      </section>
    `;

    const swatches = page.querySelector('[data-testid="token-swatches"]');
    swatches?.append(
      createTokenSwatch('Background', '--bg'),
      createTokenSwatch('Surface', '--surface'),
      createTokenSwatch('Selected', '--surface-selected'),
      createTokenSwatch('Accent', '--accent'),
    );

    return page;
  },
};
