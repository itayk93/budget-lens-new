-- Drop the partial unique index
DROP INDEX IF EXISTS facebook_comments_post_source_unique;
-- Create a regular unique constraint
ALTER TABLE public.facebook_comments 
ADD CONSTRAINT facebook_comments_post_source_unique UNIQUE (post_id, source_comment_id);
