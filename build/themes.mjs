/**
 * Built-in color presets (`--theme <name>`). Each only re-points the design
 * tokens from assets/css/00-tokens.css — accent for both color schemes and
 * the always-dark code column — so layout and typography stay identical and
 * a custom stylesheet (`--css`) can still override any of it.
 */
export const THEMES = {
  default: null,
  emerald: { accent: '#0f9d76', accentDark: '#34d399', code: ['#0b1512', '#101e1a', '#1b3029'] },
  ocean: { accent: '#0b74de', accentDark: '#4aa3ff', code: ['#0a1220', '#0f1a2e', '#1a2a47'] },
  violet: { accent: '#7c3aed', accentDark: '#a78bfa', code: ['#110d1c', '#18122a', '#2a2145'] },
  sunset: { accent: '#e2553a', accentDark: '#ff8a65', code: ['#160f0d', '#211613', '#3a2620'] },
  rose: { accent: '#e11d48', accentDark: '#fb7185', code: ['#170c10', '#221218', '#3b1f29'] },
  mono: { accent: '#27272a', accentDark: '#e4e4e7', code: ['#0a0a0a', '#141414', '#262626'] },
};

export function themeCss(name) {
  if (!name || name === 'default') return '';
  const theme = THEMES[name];
  if (!theme) {
    throw new Error(`Unknown theme "${name}". Available: ${Object.keys(THEMES).join(', ')}`);
  }
  const [bg, surface, border] = theme.code;
  return `
:root { --accent: ${theme.accent}; --code-bg: ${bg}; --code-surface: ${surface}; --code-border: ${border}; }
@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { --accent: ${theme.accentDark}; } }
:root[data-theme='dark'] { --accent: ${theme.accentDark}; }
`;
}
