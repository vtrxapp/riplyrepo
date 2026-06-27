import { supabase } from '../lib/supabase'

export async function uploadImage(file, bucket, path) {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { upsert: true, contentType: file.type })

  if (error) throw new Error(error.message)

  const { data: urlData } = supabase.storage
    .from(bucket)
    .getPublicUrl(path)

  return urlData.publicUrl
}