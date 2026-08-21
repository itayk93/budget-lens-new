CREATE UNIQUE INDEX IF NOT EXISTS facebook_comments_post_source_unique 
ON public.facebook_comments (post_id, source_comment_id) 
WHERE source_comment_id IS NOT NULL;
