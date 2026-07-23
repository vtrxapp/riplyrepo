import { supabase } from '../lib/supabase'

// Extracts a file extension from a user-supplied filename, but strips
// anything that isn't a plain alphanumeric extension first -- a crafted
// filename like "x.jpg/../../other-user/avatar" would otherwise let '/' and
// '..' segments flow straight into the storage key, letting an upload land
// somewhere other than the intended path within the bucket.
export function safeExt(filename, fallback = 'jpg') {
  const raw = String(filename || '').split('.').pop() || ''
  const cleaned = raw.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toLowerCase()
  return cleaned || fallback
}

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