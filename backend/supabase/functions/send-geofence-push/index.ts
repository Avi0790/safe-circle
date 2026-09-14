// Triggered by a Supabase Database Webhook on INSERT into
// public.geofence_events (configure the webhook after deploying — see
// backend/README.md). Looks up everyone else in the traveler's circle,
// grabs their push tokens, and sends an Expo push notification.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
    .select("token")
    .in("user_id", memberIds);

  if (!tokens || tokens.length === 0) {
    return new Response("no push tokens", { status: 200 });
  }

  const verb = event.event_type === "arrived" ? "arrived at" : "left";
  const messages = tokens.map((t) => ({
    to: t.token,
    sound: "default",
    title: "Safe Circle",
    body: `${traveler.full_name} ${verb} ${place.name}`,
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
