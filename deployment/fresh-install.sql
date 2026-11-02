-- Auto Posts: fresh CUSTOMER-OWNED project only. No seller data or credentials.
-- Not for the existing Lovable Cloud database; run ONCE in an empty project.
BEGIN;
CREATE TABLE public.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  image_path text NOT NULL, caption text NOT NULL DEFAULT '',
  scheduled_at timestamptz, status text NOT NULL DEFAULT 'draft',
  fb_post_id text, error text, posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), ig_post_id text, ig_error text,
  reel_path text, fb_reel_id text, ig_reel_id text, reel_error text, page_ref uuid
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts TO authenticated;
GRANT ALL ON public.posts TO service_role;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own posts" ON public.posts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX posts_due_idx ON public.posts(status, scheduled_at);
CREATE INDEX posts_owner_idx ON public.posts(user_id, page_ref);
CREATE TABLE public.settings (
  user_id uuid PRIMARY KEY, spreadsheet_id text, sheet_name text NOT NULL DEFAULT 'Sheet1',
  updated_at timestamptz NOT NULL DEFAULT now(), fb_page_id text, fb_token text,
  drive_folder_id text, ig_user_id text, caption_tone text NOT NULL DEFAULT 'engaging',
  brand_voice text NOT NULL DEFAULT ''
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings TO authenticated;
GRANT ALL ON public.settings TO service_role;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own settings" ON public.settings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TABLE public.fb_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  name text NOT NULL DEFAULT '', page_id text NOT NULL, token text NOT NULL,
  ig_user_id text, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fb_pages TO authenticated;
GRANT ALL ON public.fb_pages TO service_role;
ALTER TABLE public.fb_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own pages" ON public.fb_pages FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
CREATE TABLE private.cron_token (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  token text NOT NULL DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
);
INSERT INTO private.cron_token(id) VALUES (1);
REVOKE ALL ON private.cron_token FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.verify_cron_token(_token text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM private.cron_token WHERE id = 1 AND token = _token)
$$;
REVOKE ALL ON FUNCTION public.verify_cron_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_cron_token(text) TO service_role;
-- Storage service/bucket is created separately via its supported settings/API.
CREATE POLICY "read own images" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'post-images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "upload own images" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'post-images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "update own images" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'post-images' AND (storage.foldername(name))[1] = auth.uid()::text) WITH CHECK (bucket_id = 'post-images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "delete own images" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'post-images' AND (storage.foldername(name))[1] = auth.uid()::text);
COMMIT;
