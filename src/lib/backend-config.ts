/** Explicit customer configuration never falls back to the seller's project. */
export function customerBackend(url?: string, publicKey?: string) {
  if (!url && !publicKey) return null;
  if (!url || !publicKey) throw new Error('Customer backend URL and publishable key must both be configured.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('Customer backend must be an HTTPS origin.');
  if (publicKey.startsWith('sb_secret_')) throw new Error('A secret key cannot be used as a browser publishable key.');
  if (!publicKey.startsWith('sb_publishable_')) {
    try {
      const claims = JSON.parse(atob(publicKey.split('.')[1] ?? '')));
      if (claims.role !== 'anon') throw new Error('Invalid role');
    } catch { throw new Error('Use a publishable key or legacy anon key, never a service-role key.'); }
  }
  return { url: parsed.origin, publicKey };
}
export function backendFetch(key: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    if (key.startsWith('sb_') && headers.get('authorization') === `Bearer ${key}`) headers.delete('authorization');
    headers.set('apikey', key);
    return fetch(input, { ...init, headers });
  };
}
