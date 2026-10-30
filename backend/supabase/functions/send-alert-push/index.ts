// Called by public.send_alert_push() (via pg_net) — see migration
// ...000024_alert_push_helper.sql. The SQL side has already decided who to
// notify and what to say; this only turns user ids into Expo push tokens
// and delivers, in each recipient's language (_shared/pushText.ts). Same
// shared-secret check as the other push functions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { localizePush, recipientLanguages } from "../_shared/pushText.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("GEOFENCE_WEBHOOK_SECRET");

// Expo's push API accepts at most 100 messages per request.
const EXPO_BATCH_SIZE = 100;

interface AlertPayload {
  recipient_ids: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  const payload = (await req.json()) as AlertPayload;
  if (!Array.isArray(payload.recipient_ids) || payload.recipient_ids.length === 0) {
    return new Response("no recipients", { status: 200 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: tokens } = await supabase
    .from("push_tokens")
    .select("token, user_id")
    .in("user_id", payload.recipient_ids);

  if (!tokens || tokens.length === 0) {
    return new Response("no push tokens", { status: 200 });
  }

  const languages = await recipientLanguages(supabase, payload.recipient_ids);
  const messages = tokens.map((t) => ({
    to: t.token,
    sound: "default",
    ...localizePush(languages.get(t.user_id) ?? "en", payload.title, payload.body, payload.data?.type),
    data: payload.data ?? {},
  }));

  let allOk = true;
  for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages.slice(i, i + EXPO_BATCH_SIZE)),
    });
    if (!res.ok) allOk = false;
  }

  return new Response(allOk ? "sent" : "expo push failed", { status: allOk ? 200 : 502 });
});
