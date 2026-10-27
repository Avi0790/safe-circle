// Stripe tells us about payments here (migration ...000069). Every request
// must carry Stripe's signature for our webhook secret, or it's refused: this
// endpoint is public (Stripe can't send a Supabase login), so the signature
// is the only thing standing between it and anyone wanting a free plan. A
// verified event updates the organization's plan through
// stripe_sync_subscription(), which only the service role may call.
//
// Deploy with --no-verify-jwt (or config.toml) for that reason.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@22.6.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");

const cryptoProvider = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) return new Response("not configured", { status: 503 });
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("missing signature", { status: 400 });

  const stripe = new Stripe(STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, STRIPE_WEBHOOK_SECRET, undefined, cryptoProvider);
  } catch {
    return new Response("bad signature", { status: 400 });
  }

  // Whatever the event, act on the subscription as Stripe has it now, so
  // events arriving out of order can't leave a stale plan.
  let subscriptionId: string | null = null;
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      subscriptionId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id ?? null;
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      subscriptionId = (event.data.object as Stripe.Subscription).id;
      break;
    case "invoice.payment_failed":
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice & { subscription?: string | { id: string } | null };
      const sub = invoice.subscription ?? invoice.parent?.subscription_details?.subscription ?? null;
      subscriptionId = typeof sub === "string" ? sub : sub?.id ?? null;
      break;
    }
    default:
      return new Response("ignored", { status: 200 });
  }
  if (!subscriptionId) return new Response("no subscription", { status: 200 });

  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const orgId = sub.metadata?.org_id;
  if (!orgId) return new Response("not ours", { status: 200 });
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const seats = sub.items.data.reduce((total, item) => total + (item.quantity ?? 0), 0);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: state, error } = await admin.rpc("stripe_sync_subscription", {
    p_org: orgId,
    p_customer: customerId,
    p_subscription: sub.id,
    p_status: sub.status,
    p_seats: seats,
  });
  if (error) {
    // 500 makes Stripe retry later
    console.error("[stripe-webhook]", error.message);
    return new Response("could not update the plan", { status: 500 });
  }
  return new Response(`plan ${state}`, { status: 200 });
});
