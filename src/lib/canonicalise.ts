export function canonicalise(raw: string): string {
  const u = new URL(raw);
  // strip common tracking params
  ['utm_source','utm_medium','utm_campaign','fbclid','gclid']
    .forEach(p => u.searchParams.delete(p));
  const host  = u.hostname.toLowerCase();
  const path  = u.pathname.replace(/\/$/, '');
  return `${u.protocol}//${host}${path}${u.search}`;
}
