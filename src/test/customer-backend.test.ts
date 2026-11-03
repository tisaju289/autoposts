// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { customerBackend, backendFetch } from '@/lib/backend-config';
import { googleConnection } from '@/lib/google.server';
import { readFileSync } from 'node:fs';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('separate customer deployments', () => {
  it('uses only the complete customer configuration', () => {
    expect(customerBackend('https://customer.example', 'sb_publishable_customer')).toEqual({ url: 'https://customer.example', publicKey: 'sb_publishable_customer' });
    expect(customerBackend()).toBeNull();
  });
  it('never falls back on partial configuration', () => {
    expect(() => customerBackend('https://customer.example')).toThrow();
    expect(() => customerBackend(undefined, 'sb_publishable_customer')).toThrow();
  });
  it('rejects server keys in the browser', () => {
    expect(() => customerBackend('https://customer.example', 'sb_secret_private')).toThrow();
    const token = `x.${btoa(JSON.stringify({ role: 'service_role' }))}.x`;
    expect(() => customerBackend('https://customer.example', token)).toThrow();
  });
  it('keeps user bearer auth and removes opaque key bearer auth', async () => {
    const mock = vi.fn<typeof fetch>(async () => new Response()); vi.stubGlobal('fetch', mock);
    await backendFetch('sb_publishable_customer')('https://customer.example', { headers: { Authorization: 'Bearer sb_publishable_customer' } });
    expect(new Headers(mock.mock.calls[0]?.[1]?.headers).has('authorization')).toBe(false);
    await backendFetch('sb_publishable_customer')('https://customer.example', { headers: { Authorization: 'Bearer user.jwt.token' } });
    expect(new Headers(mock.mock.calls[1]?.[1]?.headers).get('authorization')).toBe('Bearer user.jwt.token');
  });
  it('does not use seller Google connections for a customer', async () => {
    vi.stubEnv('CUSTOM_BACKEND_URL', 'https://customer.example');
    vi.stubEnv('CUSTOM_GOOGLE_CLIENT_ID', '');
    await expect(googleConnection('drive')).rejects.toThrow('নিজস্ব');
  });
  it('renews customer Google consent and calls direct APIs', async () => {
    vi.stubEnv('CUSTOM_BACKEND_URL', 'https://customer.example');
    vi.stubEnv('CUSTOM_GOOGLE_CLIENT_ID', 'client');vi.stubEnv('CUSTOM_GOOGLE_CLIENT_SECRET', 'secret');vi.stubEnv('CUSTOM_GOOGLE_REFRESH_TOKEN', 'refresh');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ access_token: 'test-token' })));
    expect((await googleConnection('drive')).base).toBe('https://www.googleapis.com/drive/v3');
    expect((await googleConnection('sheets')).base).toBe('https://sheets.googleapis.com/v4');
  });
  it('has owner isolation and explicit grants for every fresh table', () => {
    const sql = readFileSync('deployment/fresh-install.sql', 'utf8');
    for (const table of ['posts','settings','fb_pages']) {
      expect(sql).toContain(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.${table} TO authenticated;`);
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`ON public.${table} FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)`);
    }
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.verify_cron_token(text) FROM PUBLIC, anon, authenticated;');
  });
});
