import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@clerk/clerk-react'
import { supabase } from '../lib/supabase'
import { deriveAvatarColor } from './useCurrentUser'

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

export function usePosts(groupId) {
  const { user } = useUser()
  const [posts,   setPosts]   = useState([])
  const [loading, setLoading] = useState(true)

  const normalize = (p) => ({
    ...p,
    time:    formatTime(p.created_at),
    author:  p.author_name || 'Member',
    aInitial:p.author_initial || (p.author_name?.[0] || 'M').toUpperCase(),
    aColor:  p.author_color || 'linear-gradient(135deg,#7C5CFF,#B06BFF)',
    text:    p.content,
    likes:   p.likes_count || 0,
    reactions: p.comment_count || 0,
  })

  useEffect(() => {
    if (!groupId) { setLoading(false); return }

    supabase
      .from('posts')
      .select('*')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setPosts((data || []).map(normalize))
        setLoading(false)
      })
      .catch(() => setLoading(false))

    const channel = supabase
      .channel(`posts:${groupId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'posts',
        filter: `group_id=eq.${groupId}`,
      }, (payload) => {
        setPosts(prev => [normalize(payload.new), ...prev])
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [groupId])

  const createPost = useCallback(async ({ content, imageUrl, currentUser }) => {
    if (!user?.id || !groupId || !content?.trim()) return { error: 'Missing fields' }
    const authorName = currentUser?.name || user.username || user.firstName || 'Member'
    const { data, error } = await supabase.from('posts').insert({
      group_id:       groupId,
      user_id:        user.id,
      content:        content.trim(),
      image_url:      imageUrl || null,
      likes_count:    0,
      comment_count:  0,
      author_name:    authorName,
      author_initial: authorName[0]?.toUpperCase() || 'M',
      author_color:   currentUser?.avatarColor || deriveAvatarColor(user.id),
    }).select().single()
    if (!error) {
      await supabase.rpc('increment_group_post_count', { gid: groupId }).catch(() =>
        supabase.from('groups').select('post_count').eq('id', groupId).single()
          .then(({ data: gr }) => supabase.from('groups').update({ post_count: (gr?.post_count || 0) + 1 }).eq('id', groupId))
      )
    }
    return { data, error }
  }, [user?.id, groupId])

  return { posts, loading, createPost }
}
