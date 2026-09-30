import { supabase } from '@/lib/supabase';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export type AskHelpResult = { ok: true; answer: string } | { ok: false; error: string };

const MAX_QUESTION_LENGTH = 500;

// NOTE: not currently used by app/(app)/ai-help.tsx — that screen uses the
// free, offline lib/helpFaq.ts matcher instead, since a real per-question
// API cost isn't worth it for a capstone demo someone could forget to keep
// funded. Kept as the ready-to-go client side of an optional upgrade: if
// this project's ANTHROPIC_API_KEY secret is ever set (see
// backend/README.md), swapping ai-help.tsx to call askHelp() here instead
// of findFaqAnswer() turns the same screen into a real LLM-backed assistant.
//
// The in-app help chatbot — the only Edge Function in this app called
// directly by the client rather than by a database trigger (see
// backend/supabase/functions/send-ai-help). It answers questions about how
// to use Safe Circle, not emergencies; the SOS button stays the thing to
// use for those.
export async function askHelp(question: string, history: ChatTurn[]): Promise<AskHelpResult> {
  const trimmed = question.trim();
  if (!trimmed) return { ok: false, error: 'Ask something first.' };
  if (trimmed.length > MAX_QUESTION_LENGTH) {
    return { ok: false, error: 'Keep questions under 500 characters.' };
  }

  const { data, error } = await supabase.functions.invoke('send-ai-help', {
    body: { question: trimmed, history },
  });

  if (error) {
    // supabase-js's FunctionsHttpError puts a generic "Edge Function
    // returned a non-2xx status code" on `error.message` — the actual
    // {error: "..."} body we send (rate limit, "not signed in", "AI help
    // hasn't been set up yet") lives on `error.context`, the raw Response.
    // Duck-typed rather than importing FunctionsHttpError, since only
    // that one error class carries a real Response there.
    const context = (error as { context?: unknown }).context;
    if (context && typeof (context as Response).json === 'function') {
      try {
        const body = (await (context as Response).json()) as { error?: string };
        if (body.error) return { ok: false, error: body.error };
      } catch {
        // Not JSON, or the body was already consumed — fall through.
      }
    }
    return { ok: false, error: error.message ?? 'Something went wrong.' };
  }
  const result = data as { answer?: string; error?: string } | null;
  if (result?.error) return { ok: false, error: result.error };
  if (!result?.answer) return { ok: false, error: "Didn't get an answer back." };
  return { ok: true, answer: result.answer };
}
