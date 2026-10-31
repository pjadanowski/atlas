/**
 * Sub-path support. Page hrefs in the model stay site-root-relative ("/tag/id/")
 * because they double as the directory layout on disk; this module turns them
 * into the URLs the browser requests, which differ once the site is mounted
 * under a prefix (Laravel's `/docs/api`, GitHub Pages' `/repo`).
 */

let base = '';

/** Normalizes to "" or "/prefix" — no trailing slash, always one leading slash. */
export function normalizeBase(value) {
  const trimmed = String(value ?? '').trim().replace(/\/+$/, '');
  if (!trimmed || trimmed === '/') return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function configureBase(value) {
  base = normalizeBase(value);
  return base;
}

/** Site-root-relative path ("/models/") → URL to link ("/docs/api/models/"). */
export function url(path) {
  return `${base}${path}`;
}
