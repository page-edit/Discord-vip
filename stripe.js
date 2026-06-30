import Stripe from "stripe";
import config from "./config.json" assert { type: "json" };

const stripe = new Stripe(process.env.STRIPE_SECRET);

// Crée une session Stripe liée à un user Discord
export async function createCheckout(discordId) {
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: config.currency,
          product_data: {
            name: config.productName
          },
          unit_amount: config.price
        },
        quantity: 1
      }
    ],
    metadata: {
      discordId
    },
    success_url: "https://discord.com",
    cancel_url: "https://discord.com"
  });

  return session.url;
}

// Vérifie webhook Stripe (sécurisé)
export function verifyWebhook(body, signature) {
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  return Stripe.webhooks.constructEvent(body, signature, endpointSecret);
}
