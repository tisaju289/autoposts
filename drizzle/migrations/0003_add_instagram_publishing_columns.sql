ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS ig_post_id text;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS ig_error text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS ig_user_id text;