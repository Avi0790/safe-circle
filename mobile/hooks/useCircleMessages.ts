import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Message } from '@/lib/types';

const MESSAGE_LIMIT = 200;

export type SendResult = { ok: true } | { ok: false; error: string };

// Loads the circle's recent chat history and appends new messages live.
// Relies entirely on the realtime INSERT event to append — including for
// the sender's own message — rather than also optimistically appending
// locally, so a message can never show up twice.
export function useCircleMessages(circleId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!circleId) {
      setMessages([]);
      setIsLoading(false);
      return;
    }
    setError(null);
    const { data, error } = await supabase
      .from('messages')
      .select('id, circle_id, user_id, body, created_at')
      .eq('circle_id', circleId)
      .order('created_at', { ascending: true })
      .limit(MESSAGE_LIMIT);
    if (error) {
      setError(error.message);
    } else {
      setMessages((data as Message[]) ?? []);
    }
    setIsLoading(false);
  }, [circleId]);

  useEffect(() => {
    setIsLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    if (!circleId) return;
    const channel = supabase
      .channel(`messages-${circleId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `circle_id=eq.${circleId}` },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as Message]);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [circleId]);

  async function send(body: string): Promise<SendResult> {
    if (!circleId) return { ok: false, error: 'No circle selected.' };
    const trimmed = body.trim();
    if (!trimmed) return { ok: false, error: 'Message is empty.' };
    const { error } = await supabase
      .from('messages')
      .insert({ circle_id: circleId, body: trimmed });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  return { messages, isLoading, error, send };
}
