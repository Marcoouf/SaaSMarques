import { NextResponse } from "next/server";
import Stripe from "stripe";

export const dynamic = "force-dynamic"; // évite l’évaluation lors du build

export async function POST() {
  const key = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!key || !priceId || !appUrl) {
    return NextResponse.json(
      { error: "Stripe non configuré (clé/priceId/appUrl manquants)" },
      { status: 500 }
    );
  }

  const stripe = new Stripe(key);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/app/dashboard?status=success`,
      cancel_url: `${appUrl}/app/dashboard?status=cancel`,
    });
    return NextResponse.json({ url: session.url });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
