import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../dist/styles.css'), 'utf8');

describe('built stylesheet', () => {
  it('declares the scoped reset before utilities so utilities win', () => {
    const reset = css.indexOf('.rc-root :where(*)');
    const utility = css.indexOf('.rc\\:px-3{');
    expect(reset).toBeGreaterThan(-1);
    expect(utility).toBeGreaterThan(reset);
  });

  it('never styles bare host elements', () => {
    // Every rule selector must be scoped by a prefixed class, .rc-root/.rc-tokens or a theme var block.
    const selectors = [...css.replace(/@[^{]+\{/g, '').matchAll(/(^|})\s*([^{}@]+)\{/g)].map((m) =>
      m[2]!.trim(),
    );
    const unscoped = selectors.filter(
      (s) => s && !/(\.rc|:root|:host|from|to|\d+%|::backdrop|\*,:after,:before|\*,::after,::before)/.test(s),
    );
    expect(unscoped).toEqual([]);
  });
});

describe('stylesheet coverage', () => {
  it('includes utilities from every component folder (none skipped by ignore rules)', () => {
    // MediaPanel lives in components/media; a gitignore pattern once hid that folder from Tailwind.
    expect(css).toContain('.rc\\:h-\\[420px\\]');
  });
});
