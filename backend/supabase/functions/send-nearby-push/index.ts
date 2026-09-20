// Triggered by evaluate_nearby() (via pg_net) — see migration
// ...000019_nearby_alerts.sql. Tells one opted-in person that a circle-mate
// just came within range. Unlike the other push functions the trigger has
// already decided who to notify, so the payload names the recipient.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Same shared secret as the geofence/SOS/message push functions.
const WEBHOOK_SECRET = Deno.env.get("GEOFENCE_WEBHOOK_SECRET");

interface Payload {
  recipient_id: string;
  other_id: string;
  meters: number;
}

Deno.serve(async (req) => {
  if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  const { recipient_id, other_id, meters } = (await req.json()) as Payload;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const [{ data: other }, { data: tokens }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", other_id).single(),
    supabase.from("push_tokens").select("token").eq("user_id", recipient_id),
  ]);

  if (!other) return new Response("person not found", { status: 200 });
  if (!tokens || tokens.length === 0) return new Response("no push tokens", { status: 200 });

  const miles = meters / 1609.344;
  const distance = miles < 0.1 ? "right next to you" : `${miles.toFixed(1)} mi away`;

  const expoRes = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(
      tokens.map((t) => ({
        to: t.token,
        sound: "default",
        title: "Nearby",
        body: `${other.full_name} is nearby — ${distance}`,
        data: { type: "nearby", userId: other_id },
      })),
    ),
  });

  return new Response(expoRes.ok ? "sent" : "expo push failed", {
    status: expoRes.ok ? 200 : 502,
  });
});
