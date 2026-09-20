// Triggered by notify_low_battery() (via pg_net) — see migration
// ...000021_low_battery_push.sql. Tells everyone who shares a circle with
// the person that their phone is running low, since a dead phone is the
// most common reason someone silently drops off the map.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Same shared secret as the other push functions.
const WEBHOOK_SECRET = Deno.env.get("GEOFENCE_WEBHOOK_SECRET");

interface Payload {
  user_id: string;
  battery: number; // 0..1
}

Deno.serve(async (req) => {
  if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  const { user_id, battery } = (await req.json()) as Payload;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: person } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user_id)
    .single();
  if (!person) return new Response("person not found", { status: 200 });

  const { data: myCircles } = await supabase
    .from("circle_members")
    .select("circle_id")
    .eq("user_id", user_id);
  const circleIds = (myCircles ?? []).map((c) => c.circle_id);
  if (circleIds.length === 0) return new Response("no circles", { status: 200 });

  const { data: members } = await supabase
    .from("circle_members")
    .select("user_id")
    .in("circle_id", circleIds)
    .neq("user_id", user_id);
  const memberIds = [...new Set((members ?? []).map((m) => m.user_id))];
  if (memberIds.length === 0) return new Response("no recipients", { status: 200 });

  const { data: tokens } = await supabase
    .from("push_tokens")
    .select("token")
    .in("user_id", memberIds);
  if (!tokens || tokens.length === 0) return new Response("no push tokens", { status: 200 });

  const pct = Math.round(battery * 100);
  const expoRes = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(
      tokens.map((t) => ({
        to: t.token,
        sound: "default",
        title: "🔋 Low battery",
        body: `${person.full_name}'s phone is at ${pct}% — location sharing may stop soon.`,
        data: { type: "low_battery", userId: user_id },
      })),
    ),
  });

  return new Response(expoRes.ok ? "sent" : "expo push failed", {
    status: expoRes.ok ? 200 : 502,
  });
});
