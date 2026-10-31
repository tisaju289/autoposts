-- Allow authenticated owners to replace their generated Reel derivatives.
-- The upload API uses an INSERT for the first object and an UPDATE for upsert replacements.
DROP POLICY IF EXISTS "update own images" ON storage.objects;
CREATE POLICY "update own images" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'post-images' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'post-images' AND (storage.foldername(name))[1] = auth.uid()::text);
