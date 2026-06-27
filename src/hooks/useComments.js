import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@clerk/clerk-react'
import { supabase } from '../lib/supabase'

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const diffMs = Date.now() - d
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function useComments(postId) {
  const { user } = useUser()
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(false)

  const normalize = (c) => ({
    ...c,
    time:     formatTime(c.created_at),
    author:   c.author_name || 'Member',
    aInitial: c.author_initial || (c.author_name?.[0] || 'M').toUpperCase(),
    aColor:   c.author_color  || 'linear-gradient(135deg,#7C5CFF,#B06BFF)',
    text:     c.content,
  })

  useEffect(() => {
    if (!postId) return
    setLoading(true)
    supabase
      .from('post_comments')
      .select('*')
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setComments((data || []).map(normalize))
        setLoading(false)
      })

    const channel = supabase
      .channel(`comments:${postId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'post_comments',
        filter: `post_id=eq.${postId}`,
      }, (payload) => {
        setComments(prev => [...prev, normalize(payload.new)])
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [postId])

  const addComment = useCallback(async (content, currentUserProfile) => {
    if (!user?.id || !postId || !content?.trim()) return
    const authorName = currentUserProfile?.name || user?.username || 'Member'
    const { data, error } = await supabase.from('post_comments').insert({
      post_id:        postId,
      user_id:        user.id,
      content:        content.trim(),
      author_name:    authorName,
      author_initial: authorName[0]?.toUpperCase() || 'M',
      author_color:   currentUserProfile?.avatarColor || 'linear-gradient(135deg,#7C5CFF,#B06BFF)',
    }).select().single()
    if (!error && data) {
      // Update comment_count on the post
      await supabase.rpc('increment_comment_count', { post_id_arg: postId }).catch(() => {})
    }
    return { data, error }
  }, [user?.id, postId])

  return { comments, loading, addComment }
}
