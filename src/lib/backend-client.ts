import { createClient } from '@supabase/supabase-js';
import { supabase as managed } from '../integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { customerBackend, backendFetch } from './backend-config';
export function isCustomerDeployment() {
  return Boolean(customerBackend(import.meta.env.VITE_CUSTOM_BACKEND_URL, import.meta.env.VITE_CUSTOM_BACKEND_PUBLISHABLE_KEY));
}
let client: ReturnType<typeof createClient<Database>> | undefined;
export const supabase = new Proxy({} as typeof managed, {
  get(_, key) {
    const config = customerBackend(import.meta.env.VITE_CUSTOM_BACKEND_URL, import.meta.env.VITE_CUSTOM_BACKEND_PUBLISHABLE_KEY);
    if (!config) return Reflect.get(managed, key);
    client ??= createClient<Database>(config.url, config.publicKey, {
      global: { fetch: backendFetch(config.publicKey) },
      auth: { persistSession: true, autoRefreshToken: true, flowType: 'pkce' },
    });
    return Reflect.get(client, key);
  },
});
