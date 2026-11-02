import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { backendFetch, customerBackend } from './backend-config';
function config() {
  const external = customerBackend(process.env['CUSTOM_BACKEND_URL'], process.env['CUSTOM_BACKEND_PUBLISHABLE_KEY']);
  if (!external && process.env['CUSTOM_BACKEND_SECRET_KEY']) throw new Error('Incomplete customer backend configuration.');
  const url = external?.url ?? process.env['SUPABASE_URL'];
  const publicKey = external?.publicKey ?? process.env['SUPABASE_PUBLISHABLE_KEY'];
  const secret = external ? process.env['CUSTOM_BACKEND_SECRET_KEY'] : process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !publicKey) throw new Error('Backend is not configured.');
  return { url, publicKey, secret };
}
export function authenticatedBackend(token: string) {
  const { url, publicKey } = config();
  return createClient<Database>(url, publicKey, {
    global: { fetch: backendFetch(publicKey), headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export function adminBackend() {
  const { url, secret } = config();
  if (!secret) throw new Error('Backend server secret is not configured.');
  return createClient<Database>(url, secret, { global: { fetch: backendFetch(secret) }, auth: { persistSession: false, autoRefreshToken: false } });
}
