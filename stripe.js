'use strict';

const Stripe = require('stripe');
const config = require('./config.json');

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('[STRIPE] STRIPE_SECRET_KEY manquant dans les variables d\'environnement.');
}
if (!process.env.STRIPE_WEBHOOK_SECRET) {
  throw new Error('[STRIPE] STRIPE_WEBHOOK_SECRET manquant dans les variables d\'environnement.');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20'
});

/**
 * Crée une session Stripe Checkout pour un utilisateur Discord donné.
 * @param {string} discordId - ID Discord de l'utilisateur qui paie.
 * @param {string} discordUsername - Username Discord (pour référence dans Stripe).
 * @returns {Promise<import('stripe').Stripe.Checkout.Session>}
 */
async function createCheckoutSession(discordId, discordUsername) {
  if (!discordId) {
    throw new Error('[STRIPE] discordId requis pour créer une session Checkout.');
  }

  const successUrl = process.env.SUCCESS_URL || 'https://example.com/success';
  const cancelUrl = process.env.CANCEL_URL || 'https://example.com/cancel';

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: config.vipCurrency || 'eur',
          product_data: {
            name: config.vipProductName || 'Accès VIP'
          },
          unit_amount: config.vipPriceCents || 499
        },
        quantity: 1
      }
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      discordId: String(discordId),
      discordUsername: String(discordUsername || 'inconnu')
    }
  });

  return session;
}

/**
 * Vérifie et construit l'event Stripe à partir du payload brut + signature.
 * @param {Buffer} rawBody - Corps brut de la requête (non parsé en JSON).
 * @param {string} signature - Header 'stripe-signature'.
 * @returns {import('stripe').Stripe.Event}
 */
function constructWebhookEvent(rawBody, signature) {
  return stripe.webhooks.constructEvent(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET
  );
}

module.exports = {
  stripe,
  createCheckoutSession,
  constructWebhookEvent
};
