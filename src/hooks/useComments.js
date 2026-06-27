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
    time:        formatTime(c.created_at),
    author:      c.author_name || 'Member',
    aInitial:    c.author_initial || (c.author_name?.[0] || 'M').toUpperCase(),
    aColor:      c.author_color  || 'linear-gradient(135deg,#19BFFF,#0098F0)',
    text:        c.content,
    likes:       c.likes_count || 0,
    replyToId:   c.reply_to_id   || null,
    replyToName: c.reply_to_name || null,
  })

  useEffect(() => {
    if (!postId) return
    setLoading(true)
    supabase
      .from('post_comments')
      .select('*')
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (error) console.error('[useComments] fetch error:', error.message, error.code)
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
        // Skip if we already have this row (optimistic or real)
        setComments(prev =>
          prev.some(c => c.id === payload.new.id)
            ? prev
            : [...prev, normalize(payload.new)]
        )
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [postId])

  const addComment = useCallback(async (content, currentUserProfile, replyTo = null) => {
    if (!postId || !content?.trim()) return
    const authorName = currentUserProfile?.name || user?.username || 'Member'
    const optimistic = normalize({
      id:             `opt-${Date.now()}`,
      post_id:        postId,
      user_id:        user?.id || 'anon',
      content:        content.trim(),
      author_name:    authorName,
      author_initial: authorName[0]?.toUpperCase() || 'M',
      author_color:   currentUserProfile?.avatarColor || 'linear-gradient(135deg,#19BFFF,#0098F0)',
      reply_to_id:    replyTo?.id    || null,
      reply_to_name:  replyTo?.author || null,
      likes_count:    0,
      created_at:     new Date().toISOString(),
    })
    // Show immediately
    setComments(prev => [...prev, optimistic])

    if (!user?.id) return
    const { data, error } = await supabase.from('post_comments').insert({
      post_id:        postId,
      user_id:        user.id,
      content:        content.trim(),
      author_name:    authorName,
      author_initial: authorName[0]?.toUpperCase() || 'M',
      author_color:   currentUserProfile?.avatarColor || 'linear-gradient(135deg,#19BFFF,#0098F0)',
      reply_to_id:    replyTo?.id    || null,
      reply_to_name:  replyTo?.author || null,
    }).select().single()
    if (error) {
      console.error('[useComments] insert error:', error.message)
      // Replace optimistic with error indicator or just leave it
    } else if (data) {
      // Replace optimistic entry with real DB row
      setComments(prev => prev.map(c => c.id === optimistic.id ? normalize(data) : c))
      await supabase.rpc('increment_comment_count', { post_id_arg: postId }).catch(() => {})
    }
    return { data, error }
  }, [user?.id, postId])

  const likeComment = useCallback(async (commentId) => {
    setComments(prev => prev.map(c => c.id === commentId ? { ...c, likes: (c.likes || 0) + 1 } : c))
    await supabase.rpc('increment_comment_likes', { comment_id_arg: commentId }).catch(() => {})
  }, [])

  return { comments, loading, addComment, likeComment }
}
