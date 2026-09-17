import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { getLastRead, setLastRead } from '@/lib/chatReadState';
import { useAuth } from '@/contexts/AuthContext';

interface ChatReadContextValue {
  unreadCount: number;
  markRead: () => Promise<void>;
}

const ChatReadContext = createContext<ChatReadContextValue>({
  unreadCount: 0,
  markRead: async () => {},
});

// Backs the Chat tab's badge (see (tabs)/_layout.tsx). Lives as a context
// — not a plain hook called separately in both the tab layout and
// chat.tsx — specifically so markRead() (called when the Chat screen
// gains focus) clears the same count the tab bar reads; two independent
// hook instances would each hold their own state, and the badge would
// stay stuck showing stale unread counts until the next message arrived.
export function ChatReadProvider({
  circleId,
  children,
}: {
  circleId: string | null;
  children: ReactNode;
}) {
  const { session } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  const recompute = useCallback(async () => {
    if (!circleId || !session) {
      setUnreadCount(0);
      return;
    }
    const lastRead = await getLastRead(circleId);
    let query = supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('circle_id', circleId)
      .neq('user_id', session.user.id);
    if (lastRead) {
      query = query.gt('created_at', lastRead);
    }
    const { count } = await query;
    setUnreadCount(count ?? 0);
  }, [circleId, session]);

  useEffect(() => {
    recompute();
  }, [recompute]);

  useEffect(() => {
    if (!circleId) return;
    const channel = supabase
      .channel(`unread-messages-${circleId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `circle_id=eq.${circleId}` },
        () => recompute(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [circleId, recompute]);

  const markRead = useCallback(async () => {
    if (!circleId) return;
    await setLastRead(circleId, new Date().toISOString());
    setUnreadCount(0);
  }, [circleId]);

  return (
    <ChatReadContext.Provider value={{ unreadCount, markRead }}>
      {children}
    </ChatReadContext.Provider>
  );
}

export function useChatRead() {
  return useContext(ChatReadContext);
}
