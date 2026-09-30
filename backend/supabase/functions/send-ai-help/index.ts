// In-app help chatbot — answers questions about how to use Safe Circle.
// Called directly by the signed-in mobile app (mobile/lib/aiHelp.ts), unlike
// every other function in this project, which is triggered by a database
// webhook via pg_net. Because of that, this one relies on Supabase's normal
// JWT verification (the caller's own auth session) instead of the
// X-Webhook-Secret pattern those use — there's no trigger identity to prove,
// just an ordinary authenticated request.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Not set by default — this feature has a real per-message cost, unlike
// everything else in this app, so it's opt-in via `supabase secrets set`
// rather than assumed to exist. See backend/README.md for setup.
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const MAX_MESSAGES_PER_HOUR = 20;
const MAX_QUESTION_LENGTH = 500;
// Keeps each request small (and cheap) rather than sending the whole
// conversation back every time.
const MAX_HISTORY_TURNS = 6;

const SYSTEM_PROMPT = `You are the in-app help assistant for Safe Circle, a
family location-sharing app. You answer questions about how to use the app
and give general, non-emergency safety habits (e.g. "share your live
location before a first date"). You are not a substitute for emergency
services and must never try to be.

If someone describes an ongoing emergency, a medical crisis, or immediate
danger, do not attempt to help them yourself: tell them plainly to use the
app's SOS button (which also offers a one-tap "Call 911") or to call
emergency services directly, and say nothing else.

Keep answers short: 2-4 plain sentences, no markdown, no headers, no lists
unless truly necessary.

Safe Circle's features, for reference: circles joined by invite code
(optionally requiring the creator's approval); a live map with profile
photos, quick status chips, driving status and battery level; a satellite
map toggle; temporary sharing windows and Ghost Mode (hide your location
from one specific person); Walk Me Home and Check On Me timers, which
auto-alert the circle with your last known location if you don't check in
in time; Need a Ride (alerts nearby driving circle-mates); the SOS button,
with acknowledge-and-escalation so an unanswered alert keeps re-notifying;
a medical card visible to the circle only during your own active SOS;
curfew alerts; meetup pins; guest tracking links for people without the
app; Text for Help as an SMS fallback when there's no internet; a log of
who's viewed your location history; auto-delete history settings; an
optional Face ID/passcode app lock; and Download My Data / Delete My
Account in Settings.`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Not signed in." }, 401);

  // Identifies the caller from their own session — this function is invoked
  // directly by the app (not a database trigger), so the real user JWT is
  // available, unlike the webhook-triggered functions.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return jsonResponse({ error: "Not signed in." }, 401);
  const userId = userData.user.id;

  if (!ANTHROPIC_API_KEY) {
    return jsonResponse(
      { error: "AI help hasn't been set up for this project yet." },
      503,
    );
  }

  let body: { question?: string; history?: { role: string; content: string }[] };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Bad request." }, 400);
  }

  const question = (body.question ?? "").trim();
  if (!question) return jsonResponse({ error: "Ask something first." }, 400);
  if (question.length > MAX_QUESTION_LENGTH) {
    return jsonResponse({ error: "Keep questions under 500 characters." }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Rate limit: one counter row per user, reset on a rolling one-hour
  // window — same "committed state, no rollback surprises" reasoning as the
  // invite-code and SOS limits, just a single row instead of a count query
  // since this can be called far more often than either of those.
  const windowLenMs = 60 * 60 * 1000;
  const { data: usage } = await admin
    .from("ai_help_usage")
    .select("window_start, message_count")
    .eq("user_id", userId)
    .maybeSingle();

  const now = Date.now();
  const withinWindow = usage != null && now - new Date(usage.window_start).getTime() < windowLenMs;
  const nextCount = withinWindow ? usage.message_count + 1 : 1;

  if (withinWindow && nextCount > MAX_MESSAGES_PER_HOUR) {
    return jsonResponse({ error: "Too many questions this hour — try again later." }, 429);
  }

  await admin.from("ai_help_usage").upsert({
    user_id: userId,
    window_start: withinWindow ? usage!.window_start : new Date(now).toISOString(),
    message_count: nextCount,
  });

  const history = Array.isArray(body.history)
    ? body.history
        .filter((turn) => (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string")
        .slice(-MAX_HISTORY_TURNS)
    : [];

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [...history, { role: "user", content: question }],
    }),
  });

  if (!anthropicRes.ok) {
    return jsonResponse({ error: "The help assistant is unavailable right now." }, 502);
  }

  const anthropicJson = (await anthropicRes.json()) as {
    content?: { type: string; text?: string }[];
  };
  const answer = anthropicJson.content?.find((block) => block.type === "text")?.text;
  if (!answer) return jsonResponse({ error: "Didn't get an answer back — try rephrasing." }, 502);

  return jsonResponse({ answer });
});
