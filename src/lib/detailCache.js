// Simple in-memory, session-lifetime cache for event/space/group detail data.
//
// Every detail screen (EventDetailsScreen, SpaceDetailsScreen,
// GroupProfileScreen) used to start from a blank/null state and always
// re-fetch from Supabase on open, showing a loading skeleton (or, worse, a
// flash of unrelated mock data) for a second or two -- even for something
// the user had already opened, or that was already fully loaded a moment
// earlier in the list they tapped it from. Seeding this cache from the list
// hooks (useEvents/useSpaces/useGroups) and reading it as the detail
// screen's *initial* state lets a revisit (or a first open coming from an
// already-loaded list) render instantly; the screen still kicks off a fresh
// fetch in the background to keep the cache correct, it just doesn't block
// the first paint on it.
const MAX_ENTRIES_PER_KIND = 200

const stores = {
  event: new Map(),
  space: new Map(),
  group: new Map(),
}

// Map preserves insertion order, so re-inserting a key on every read/write
// (see getCached/setCached) keeps recently-touched entries at the end --
// good enough approximation of LRU for a cache this small, without pulling
// in a real LRU structure. Caps each kind independently so one very active
// session can't grow this unboundedly.
function touch(store, id, data) {
  if (store.has(id)) store.delete(id)
  store.set(id, data)
  if (store.size > MAX_ENTRIES_PER_KIND) {
    store.delete(store.keys().next().value)
  }
}

export function getCached(kind, id) {
  if (!id) return null
  const store = stores[kind]
  const hit = store?.get(id)
  if (hit) touch(store, id, hit)
  return hit ?? null
}

export function setCached(kind, id, data) {
  const store = stores[kind]
  if (id && data && store) touch(store, id, data)
}

export function setCachedMany(kind, rows, idKey = 'id') {
  const store = stores[kind]
  if (!store) return
  for (const row of rows || []) {
    if (row?.[idKey]) touch(store, row[idKey], row)
  }
}

// A confirmed-deleted (or otherwise no-longer-visible) row shouldn't keep
// rendering from a stale cache entry forever.
export function evictCached(kind, id) {
  if (id) stores[kind]?.delete(id)
}

// Clears every kind -- called on sign-out/sign-in so one account's cached
// detail data (which can include private group info) can't briefly surface
// under a different account signed in later in the same session.
export function clearDetailCache() {
  for (const store of Object.values(stores)) store.clear()
}
