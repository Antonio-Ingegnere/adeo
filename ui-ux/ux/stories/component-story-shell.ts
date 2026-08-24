export const createComponentStoryShell = (
  componentId: string,
  title: string,
  description: string,
): { page: HTMLElement; content: HTMLElement } => {
  const theme = document.documentElement.dataset.adeoTheme ?? 'light';
  const page = document.createElement('main');
  page.className = 'component-story';
  page.dataset.p14Component = componentId;
  page.dataset.storybookP14 = 'ready';
  page.innerHTML = `
    <header class="component-story__header">
      <div>
        <p class="component-story__eyebrow">Adeo production component</p>
        <h1>${title}</h1>
        <p class="component-story__description">${description}</p>
      </div>
      <span class="component-story__theme" data-testid="active-theme">${theme} theme</span>
    </header>
    <div class="component-story__content" data-testid="component-states"></div>
  `;

  const content = page.querySelector<HTMLElement>('[data-testid="component-states"]');
  if (!content) throw new Error('Component story shell did not create its content region.');
  return { page, content };
};

export const createStateSample = (
  title: string,
  state: string,
  wide = false,
): { sample: HTMLElement; body: HTMLElement } => {
  const sample = document.createElement('section');
  sample.className = `component-story__sample${wide ? ' component-story__sample--wide' : ''}`;
  sample.dataset.state = state;

  const heading = document.createElement('h2');
  heading.textContent = title;
  const body = document.createElement('div');
  body.className = 'component-story__sample-body';
  sample.append(heading, body);
  return { sample, body };
};
