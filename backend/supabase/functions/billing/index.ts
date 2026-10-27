// Starts a Stripe payment for an organization's worker seats, or opens
// Stripe's billing portal for one already paying (migration ...000069).
// Called from the web dashboard's Plan tab with the signed-in owner's JWT;
// the card details are typed into Stripe's own pages, never ours. Whether
// the payment worked is decided later, by Stripe's signed webhook
// (stripe-webhook), not by anything this function or the browser says.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@22.6.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const STRIPE_PRICE_ID = Deno.env.get("STRIPE_PRICE_ID"); // $4 per seat per month
const APP_URL = Deno.env.get("APP_URL") ?? "http://localhost:5173";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID) {
    return reply(503, { error: "Payments aren't set up on this server yet." });
  }

  const { action, org_id, seats } = (await req.json().catch(() => ({}))) as {
    action?: string;
    org_id?: string;
    seats?: number;
  };
  if (!org_id || (action !== "checkout" && action !== "portal")) {
    return reply(400, { error: "Bad request." });
  }

  // Who's asking, as themselves: my_orgs() only answers for the caller.
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: orgs, error: orgsError } = await asUser.rpc("my_orgs");
  if (orgsError) return reply(401, { error: "Sign in again." });
  const org = (orgs as { org_id: string; name: string; role: string }[]).find((o) => o.org_id === org_id);
  if (!org || org.role !== "owner") return reply(403, { error: "Only the owner can pay for the organization." });

  const stripe = new Stripe(STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: customer } = await admin.rpc("org_stripe_customer", { p_org: org_id });

  if (action === "portal") {
    if (!customer) return reply(400, { error: "This organization doesn't pay through Stripe yet." });
    const portal = await stripe.billingPortal.sessions.create({
      customer: customer as string,
      return_url: `${APP_URL}/?billing=portal`,
    });
    return reply(200, { url: portal.url });
  }

  const quantity = Math.round(Number(seats));
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > 500) {
    return reply(400, { error: "Choose between 1 and 500 seats." });
  }
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: STRIPE_PRICE_ID, quantity }],
    ...(customer ? { customer: customer as string } : {}),
    client_reference_id: org_id,
    // the webhook reads the organization from the subscription itself
    subscription_data: { metadata: { org_id } },
    metadata: { org_id },
    success_url: `${APP_URL}/?billing=success`,
    cancel_url: `${APP_URL}/?billing=cancel`,
  });
  return reply(200, { url: session.url });
});
