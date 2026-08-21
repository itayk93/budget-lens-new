
-- Step 1: Add parent_id column to tags
ALTER TABLE public.tags ADD COLUMN parent_id uuid REFERENCES public.tags(id) ON DELETE SET NULL;
CREATE INDEX idx_tags_parent_id ON public.tags(parent_id);

-- Step 2: Update existing tag names to match taxonomy
UPDATE public.tags SET name = 'אשראי', slug = 'אשראי' WHERE id = '77283d98-75ef-4f49-94ba-2a60ed62062b'; -- עולם האשראי → אשראי
UPDATE public.tags SET name = 'משכנתא', slug = 'משכנתא' WHERE id = '1bcfea5f-3b2e-4be7-b7d7-13cbb903556d'; -- משכנתה → משכנתא

-- Step 3: Insert new parent tag
INSERT INTO public.tags (name, slug) VALUES ('גיוס / שימור לקוחות', 'גיוס-שימור-לקוחות');

-- Step 4: Set parent_id for existing "ארנק דיגיטלי" under "כרטיסי אשראי"
UPDATE public.tags SET parent_id = '2f06e938-6c4c-4a82-8516-3a88055bfdb9' WHERE id = '741ad59f-1f91-4c18-a39e-7efe17ab09b7';

-- Step 5: Rename "הלוואות" to "הלוואה" and set parent to "אשראי"
UPDATE public.tags SET name = 'הלוואה', slug = 'הלוואה', parent_id = '77283d98-75ef-4f49-94ba-2a60ed62062b' WHERE id = 'd2e1ba3b-b588-4acf-ad7c-3cfb2c4ab74c';

-- Step 6: Insert child tags under אשראי (77283d98...)
INSERT INTO public.tags (name, slug, parent_id) VALUES
  ('הקמת מסגרת', 'הקמת-מסגרת', '77283d98-75ef-4f49-94ba-2a60ed62062b'),
  ('הגדלת מסגרת', 'הגדלת-מסגרת', '77283d98-75ef-4f49-94ba-2a60ed62062b'),
  ('מיחזור הלוואות', 'מיחזור-הלוואות', '77283d98-75ef-4f49-94ba-2a60ed62062b');

-- Step 7: Insert child tags under כרטיסי אשראי (2f06e938...)
INSERT INTO public.tags (name, slug, parent_id) VALUES
  ('כרטיס אשראי', 'כרטיס-אשראי', '2f06e938-6c4c-4a82-8516-3a88055bfdb9'),
  ('כרטיס חוץ בנקאי', 'כרטיס-חוץ-בנקאי', '2f06e938-6c4c-4a82-8516-3a88055bfdb9'),
  ('שפעול כרטיס אשראי', 'שפעול-כרטיס-אשראי', '2f06e938-6c4c-4a82-8516-3a88055bfdb9'),
  ('צפייה בפרטי כרטיס', 'צפייה-בפרטי-כרטיס', '2f06e938-6c4c-4a82-8516-3a88055bfdb9'),
  ('כרטיס דביט / דיירקט', 'כרטיס-דביט-דיירקט', '2f06e938-6c4c-4a82-8516-3a88055bfdb9'),
  ('פועלים וונדר Poalim Wonder', 'פועלים-וונדר', '2f06e938-6c4c-4a82-8516-3a88055bfdb9');

-- Step 8: Insert child tags under משכנתא (1bcfea5f...)
INSERT INTO public.tags (name, slug, parent_id) VALUES
  ('אישור עקרוני למשכנתא', 'אישור-עקרוני-למשכנתא', '1bcfea5f-3b2e-4be7-b7d7-13cbb903556d'),
  ('לקיחת משכנתא', 'לקיחת-משכנתא', '1bcfea5f-3b2e-4be7-b7d7-13cbb903556d'),
  ('מיחזור משכנתא', 'מיחזור-משכנתא', '1bcfea5f-3b2e-4be7-b7d7-13cbb903556d');

-- Step 9: Insert child tags under שוק ההון (bd7816ea...)
INSERT INTO public.tags (name, slug, parent_id) VALUES
  ('אפליקציית שוק ההון', 'אפליקציית-שוק-ההון', 'bd7816ea-031b-4583-8620-acc9b084d50b'),
  ('פגישת ייעוץ בשוק ההון', 'פגישת-ייעוץ-בשוק-ההון', 'bd7816ea-031b-4583-8620-acc9b084d50b');

-- Step 10: Insert child tags under גיוס / שימור (will use subquery for the new parent)
INSERT INTO public.tags (name, slug, parent_id) VALUES
  ('ניוד', 'ניוד', (SELECT id FROM public.tags WHERE slug = 'גיוס-שימור-לקוחות')),
  ('הצטרפות לבנק', 'הצטרפות-לבנק', (SELECT id FROM public.tags WHERE slug = 'גיוס-שימור-לקוחות')),
  ('פועלים פרו PRO', 'פועלים-פרו', (SELECT id FROM public.tags WHERE slug = 'גיוס-שימור-לקוחות')),
  ('גיוס - פועלים פלוס', 'גיוס-פועלים-פלוס', (SELECT id FROM public.tags WHERE slug = 'גיוס-שימור-לקוחות')),
  ('גיוס - פועלים אקסטרא', 'גיוס-פועלים-אקסטרא', (SELECT id FROM public.tags WHERE slug = 'גיוס-שימור-לקוחות'));

-- Allow authenticated users to insert tags (for inline creation from TagSelector)
CREATE POLICY "Authenticated can insert tags"
ON public.tags FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);
;
