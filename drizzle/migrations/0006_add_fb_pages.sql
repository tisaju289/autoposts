CREATE TABLE public.fb_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL DEFAULT '',
  page_id text NOT NULL,
  token text NOT NULL,
  ig_user_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fb_pages TO authenticated;
GRANT ALL ON public.fb_pages TO service_role;
ALTER TABLE public.fb_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own pages" ON public.fb_pages FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
ALTER TABLE public.posts ADD COLUMN page_ref uuid;