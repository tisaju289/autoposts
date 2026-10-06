ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS fb_page_id text,
  ADD COLUMN IF NOT EXISTS fb_token text;