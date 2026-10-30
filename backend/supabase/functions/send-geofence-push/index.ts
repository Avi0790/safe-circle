// Triggered by the notify_geofence_event() trigger (via pg_net) on INSERT
// into public.geofence_events — see migration
// ...000009_geofence_webhook_secret.sql. Looks up everyone else in the
// traveler's circle, grabs their push tokens, and sends an Expo push
// notification.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PUSH, recipientLanguages } from "../_shared/pushText.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("GEOFENCE_WEBHOOK_SECRET");

interface GeofenceEvent {
  id: number;
  place_id: string;
  user_id: string;
  event_type: "arrived" | "left";
}

interface WebhookPayload {
  type: "INSERT";
  table: "geofence_events";
  record: GeofenceEvent;
}

Deno.serve(async (req) => {
  // `verify_jwt` alone isn't real authorization here — the public anon
  // key satisfies it trivially, so without this check anyone holding that
  // key could POST a fabricated payload and trigger a real notification
  // to real circle members. Require the shared secret only our own
  // trigger knows (see migration ...000009).
  if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  const payload = (await req.json()) as WebhookPayload;
  const event = payload.record;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const [{ data: place }, { data: traveler }] = await Promise.all([
    supabase.from("places").select("name, circle_id").eq("id", event.place_id).single(),
    supabase.from("profiles").select("full_name").eq("id", event.user_id).single(),
  ]);

  if (!place || !traveler) {
    return new Response("place or traveler not found", { status: 200 });
  }

  const { data: members } = await supabase
    .from("circle_members")
    .select("user_id")
    .eq("circle_id", place.circle_id)
    .neq("user_id", event.user_id);

  const memberIds = (members ?? []).map((m) => m.user_id);
  if (memberIds.length === 0) {
    return new Response("no recipients", { status: 200 });
  }

  const { data: tokens } = await supabase
    .from("push_tokens")
    .select("token, user_id")
    .in("user_id", memberIds);

  if (!tokens || tokens.length === 0) {
    return new Response("no push tokens", { status: 200 });
  }

  const languages = await recipientLanguages(supabase, memberIds);
  const messages = tokens.map((t) => ({
    to: t.token,
    sound: "default",
    ...PUSH.place(languages.get(t.user_id) ?? "en", traveler.full_name, event.event_type === "arrived", place.name),
  }));

  const expoRes = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(messages),
  });

  await supabase.from("geofence_events").update({ notified: expoRes.ok }).eq("id", event.id);

  return new Response(expoRes.ok ? "sent" : "expo push failed", {
    status: expoRes.ok ? 200 : 502,
  });
});
