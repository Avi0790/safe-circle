// Triggered by the notify_sos_event() trigger (via pg_net) on INSERT into
// public.sos_events — see migration ...000012_sos.sql. Notifies everyone
// who shares ANY circle with the person who triggered the SOS (not
// scoped to one circle, since sos_events isn't circle-scoped either —
// same pattern as `locations`).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Reuses the same shared secret as send-geofence-push (see that
// function's comment) rather than minting a second one.
const WEBHOOK_SECRET = Deno.env.get("GEOFENCE_WEBHOOK_SECRET");

interface SosEvent {
  id: number;
  user_id: string;
  latitude: number;
  longitude: number;
  message: string | null;
}

interface WebhookPayload {
  type: "INSERT";
  table: "sos_events";
  record: SosEvent;
}

Deno.serve(async (req) => {
  if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  const payload = (await req.json()) as WebhookPayload;
  const event = payload.record;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: traveler } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", event.user_id)
    .single();

  if (!traveler) {
    return new Response("traveler not found", { status: 200 });
  }

  const { data: myCircles } = await supabase
    .from("circle_members")
    .select("circle_id")
    .eq("user_id", event.user_id);

  const circleIds = (myCircles ?? []).map((c) => c.circle_id);
  if (circleIds.length === 0) {
    return new Response("no circles", { status: 200 });
  }

  const { data: members } = await supabase
    .from("circle_members")
    .select("user_id")
    .in("circle_id", circleIds)
    .neq("user_id", event.user_id);

  const memberIds = [...new Set((members ?? []).map((m) => m.user_id))];
  if (memberIds.length === 0) {
    return new Response("no recipients", { status: 200 });
  }

  const { data: tokens } = await supabase
    .from("push_tokens")
    .select("token")
    .in("user_id", memberIds);

  if (!tokens || tokens.length === 0) {
    return new Response("no push tokens", { status: 200 });
  }

  const messages = tokens.map((t) => ({
    to: t.token,
    sound: "default",
    priority: "high",
    title: "🆘 SOS",
    body: `${traveler.full_name} needs help!${event.message ? ` "${event.message}"` : ""}`,
    data: { type: "sos", sosEventId: event.id, latitude: event.latitude, longitude: event.longitude },
  }));

  const expoRes = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(messages),
  });

  await supabase.from("sos_events").update({ notified: expoRes.ok }).eq("id", event.id);

  return new Response(expoRes.ok ? "sent" : "expo push failed", {
    status: expoRes.ok ? 200 : 502,
  });
});
