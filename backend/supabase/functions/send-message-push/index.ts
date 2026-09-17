// Triggered by the notify_new_message() trigger (via pg_net) on INSERT
// into public.messages — see migration ...000017_message_push.sql.
// Notifies everyone else in the message's circle, same pattern as
// send-geofence-push.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Reuses the same shared secret as send-geofence-push/send-sos-push (see
// those functions' comments) rather than minting a third one.
const WEBHOOK_SECRET = Deno.env.get("GEOFENCE_WEBHOOK_SECRET");

const BODY_PREVIEW_LENGTH = 120;

interface MessageRow {
  id: number;
  circle_id: string;
  user_id: string;
  body: string;
}

interface WebhookPayload {
  type: "INSERT";
  table: "messages";
  record: MessageRow;
}

Deno.serve(async (req) => {
  if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  const payload = (await req.json()) as WebhookPayload;
  const message = payload.record;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const [{ data: circle }, { data: sender }] = await Promise.all([
    supabase.from("circles").select("name").eq("id", message.circle_id).single(),
    supabase.from("profiles").select("full_name").eq("id", message.user_id).single(),
  ]);

  if (!circle || !sender) {
    return new Response("circle or sender not found", { status: 200 });
  }

  const { data: members } = await supabase
    .from("circle_members")
    .select("user_id")
    .eq("circle_id", message.circle_id)
    .neq("user_id", message.user_id);

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

  const preview =
    message.body.length > BODY_PREVIEW_LENGTH
      ? `${message.body.slice(0, BODY_PREVIEW_LENGTH)}…`
      : message.body;

  const notificationMessages = tokens.map((t) => ({
    to: t.token,
    sound: "default",
    title: circle.name,
    body: `${sender.full_name}: ${preview}`,
    data: { type: "message", circleId: message.circle_id },
  }));

  const expoRes = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(notificationMessages),
  });

  return new Response(expoRes.ok ? "sent" : "expo push failed", {
    status: expoRes.ok ? 200 : 502,
  });
});
