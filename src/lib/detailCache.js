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
const stores = {
  event: new Map(),
  space: new Map(),
  group: new Map(),
}

export function getCached(kind, id) {
  if (!id) return null
  return stores[kind]?.get(id) ?? null
}

export function setCached(kind, id, data) {
  if (id && data) stores[kind]?.set(id, data)
}

export function setCachedMany(kind, rows, idKey = 'id') {
  const store = stores[kind]
  if (!store) return
  for (const row of rows || []) {
    if (row?.[idKey]) store.set(row[idKey], row)
  }
}
