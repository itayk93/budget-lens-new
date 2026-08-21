-- Facebook Groups Monitor tables

-- 1. facebook_groups
CREATE TABLE public.facebook_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  url text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  max_posts_per_day integer NOT NULL DEFAULT 15 CHECK (max_posts_per_day >= 1 AND max_posts_per_day <= 50),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_run_at timestamptz,
  last_success_at timestamptz,
  deleted_at timestamptz
);
ALTER TABLE public.facebook_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all select on facebook_groups" ON public.facebook_groups FOR SELECT USING (true);
CREATE POLICY "Allow all insert on facebook_groups" ON public.facebook_groups FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on facebook_groups" ON public.facebook_groups FOR UPDATE USING (true);
CREATE POLICY "Allow all delete on facebook_groups" ON public.facebook_groups FOR DELETE USING (true);
-- 2. facebook_posts
CREATE TABLE public.facebook_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.facebook_groups(id) ON DELETE CASCADE,
  source_post_id text,
  post_url text NOT NULL,
  author_name text,
  author_url text,
  text text,
  media_urls jsonb,
  created_at_source timestamptz NOT NULL,
  scraped_at timestamptz NOT NULL DEFAULT now(),
  stats jsonb,
  date_key date NOT NULL,
  UNIQUE(group_id, post_url)
);
CREATE INDEX idx_facebook_posts_group_date ON public.facebook_posts (group_id, date_key, created_at_source DESC);
ALTER TABLE public.facebook_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all select on facebook_posts" ON public.facebook_posts FOR SELECT USING (true);
CREATE POLICY "Allow all insert on facebook_posts" ON public.facebook_posts FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on facebook_posts" ON public.facebook_posts FOR UPDATE USING (true);
CREATE POLICY "Allow all delete on facebook_posts" ON public.facebook_posts FOR DELETE USING (true);
-- 3. facebook_comments
CREATE TABLE public.facebook_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.facebook_posts(id) ON DELETE CASCADE,
  source_comment_id text,
  comment_url text,
  author_name text,
  author_url text,
  text text,
  created_at_source timestamptz,
  scraped_at timestamptz NOT NULL DEFAULT now(),
  parent_comment_id uuid REFERENCES public.facebook_comments(id)
);
-- Partial unique index: if source_comment_id exists, dedupe by it
CREATE UNIQUE INDEX idx_fb_comments_source_id ON public.facebook_comments (post_id, source_comment_id) WHERE source_comment_id IS NOT NULL;
-- Partial unique index: if no source_comment_id but comment_url exists
CREATE UNIQUE INDEX idx_fb_comments_url ON public.facebook_comments (post_id, comment_url) WHERE source_comment_id IS NULL AND comment_url IS NOT NULL;
ALTER TABLE public.facebook_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all select on facebook_comments" ON public.facebook_comments FOR SELECT USING (true);
CREATE POLICY "Allow all insert on facebook_comments" ON public.facebook_comments FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on facebook_comments" ON public.facebook_comments FOR UPDATE USING (true);
CREATE POLICY "Allow all delete on facebook_comments" ON public.facebook_comments FOR DELETE USING (true);
-- 4. facebook_scrape_runs
CREATE TABLE public.facebook_scrape_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.facebook_groups(id) ON DELETE CASCADE,
  run_type text NOT NULL DEFAULT 'manual',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  new_posts_count integer NOT NULL DEFAULT 0,
  new_comments_count integer NOT NULL DEFAULT 0,
  error_message text,
  raw_meta jsonb
);
ALTER TABLE public.facebook_scrape_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all select on facebook_scrape_runs" ON public.facebook_scrape_runs FOR SELECT USING (true);
CREATE POLICY "Allow all insert on facebook_scrape_runs" ON public.facebook_scrape_runs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on facebook_scrape_runs" ON public.facebook_scrape_runs FOR UPDATE USING (true);
CREATE POLICY "Allow all delete on facebook_scrape_runs" ON public.facebook_scrape_runs FOR DELETE USING (true);
-- Trigger to update updated_at on facebook_groups
CREATE OR REPLACE FUNCTION public.update_facebook_groups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER update_facebook_groups_updated_at
BEFORE UPDATE ON public.facebook_groups
FOR EACH ROW
EXECUTE FUNCTION public.update_facebook_groups_updated_at();
