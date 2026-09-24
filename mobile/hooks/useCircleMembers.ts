import { useCircleMembersContext } from '@/contexts/CircleMembersContext';

// Members of the selected circle plus their latest locations, kept live.
// This is now just a reader of CircleMembersProvider (mounted once in
// app/(app)/_layout.tsx) — the Map, Members and Chat tabs are all mounted at
// once, and each fetching and subscribing on its own tripled the network
// and realtime work. The circle id argument is kept so existing callers
// don't change; the provider always follows the selected circle.
export function useCircleMembers(_circleId?: string | null) {
  return useCircleMembersContext();
}
