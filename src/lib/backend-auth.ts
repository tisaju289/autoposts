import { createMiddleware } from '@tanstack/react-start';
import { supabase } from './backend-client';
export const attachBackendAuth = createMiddleware({ type: 'function' }).client(async ({ next }) => {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return next({ headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {} });
});
export const requireBackendAuth = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  const { getRequest } = await import('@tanstack/react-start/server');
  const { authenticatedBackend } = await import('./backend.server');
  const token = /^Bearer (\S+)$/.exec(getRequest().headers.get('authorization') ?? '')?.[1];
  if (!token) throw new Error('Unauthorized');
  const db = authenticatedBackend(token);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new Error('Unauthorized');
  return next({ context: { supabase: db, userId: data.user.id, claims: { sub: data.user.id } } });
});
