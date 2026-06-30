'use strict';

require('dotenv').config();

const express = require('express');
const { client, grantVipAccess } = require('./discord.js');
const { constructWebhookEvent } = require('./stripe.js');

const REQUIRED_ENV_VARS = [
  'DISCORD_TOKEN',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET'
];

for (const key of REQUIRED_ENV_VARS) {
  if (!process.env[key]) {
    console.error(`[CONFIG] Variable d'environnement manquante: ${key}`);
    process.exit(1);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// IMPORTANT : la route webhook doit recevoir le body BRUT (Buffer)
// pour que la vérification de signature Stripe fonctionne.
// On la déclare donc AVANT tout express.json() global.
app.post(
  '/webhook/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];

    let event;
    try {
      event = constructWebhookEvent(req.body, signature);
    } catch (err) {
      console.error('[WEBHOOK] Signature invalide:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // On répond immédiatement à Stripe pour éviter les timeouts/retry inutiles
    res.status(200).json({ received: true });

    try {
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;

        if (session.payment_status !== 'paid') {
          console.warn(`[WEBHOOK] Session ${session.id} reçue mais non payée (status=${session.payment_status}).`);
          return;
        }

        const discordId = session.metadata && session.metadata.discordId;

        if (!discordId) {
          console.error(`[WEBHOOK] Session ${session.id} sans discordId dans metadata. Impossible d'attribuer le rôle VIP.`);
          return;
        }

        try {
          await grantVipAccess(discordId);
          console.log(`[WEBHOOK] Paiement validé et rôle VIP attribué pour discordId=${discordId}`);
        } catch (err) {
          console.error(`[WEBHOOK] Erreur attribution rôle VIP pour discordId=${discordId}:`, err.message);
        }
      } else {
        console.log(`[WEBHOOK] Event ignoré: ${event.type}`);
      }
    } catch (err) {
      console.error('[WEBHOOK] Erreur traitement event:', err);
    }
  }
);

// Tout le reste de l'app peut utiliser express.json() normalement
app.use(express.json());

app.get('/', (req, res) => {
  res.status(200).send('VIP Discord Bot - OK');
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    discordReady: client.isReady(),
    uptime: process.uptime()
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route introuvable' });
});

app.use((err, req, res, next) => {
  console.error('[EXPRESS] Erreur non gérée:', err);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

process.on('unhandledRejection', (reason) => {
  console.error('[PROCESS] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[PROCESS] Uncaught Exception:', err);
});

async function start() {
  app.listen(PORT, () => {
    console.log(`[EXPRESS] Serveur webhook démarré sur le port ${PORT}`);
  });

  try {
    await client.login(process.env.DISCORD_TOKEN);
  } catch (err) {
    console.error('[DISCORD] Échec de connexion du bot:', err);
    process.exit(1);
  }
}

start();
