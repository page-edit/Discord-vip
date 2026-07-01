import "dotenv/config";
import express from "express";
import Stripe from "stripe";
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from "discord.js";

const app = express();

const stripe = new Stripe(process.env.STRIPE_SECRET);

// ================= CONFIG =================
const config = {
  guildId: "1520354094399750144",
  vipRoleId: "1521573014309834822",
  panelChannelId: "1521560504189845555",
  baseUrl: "https://discord-vip.onrender.com"
};

// ================= DISCORD BOT =================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// ================= EXPRESS =================
// IMPORTANT: webhook raw BEFORE json
app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.log("Webhook error:", err.message);
    return res.sendStatus(400);
  }

  // ================= PAYMENT SUCCESS =================
  if (event.type === "checkout.session.completed") {
    const discordId = event.data.object.metadata?.discordId;
    console.log("PAYMENT SUCCESS FOR:", discordId);

    try {
      const guild = await client.guilds.fetch(config.guildId);
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) return res.sendStatus(404);

      const vipRole = guild.roles.cache.get(config.vipRoleId);
      if (vipRole) await member.roles.add(vipRole);

      const channel = await guild.channels.fetch(config.panelChannelId);
      channel.send(`💎 VIP ACTIVÉ : <@${discordId}>`);
    } catch (err) {
      console.log("VIP ERROR:", err.message);
    }
  }

  res.json({ received: true });
});

app.use(express.json());

// ================= BOT READY =================
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const channel = await client.channels.fetch(config.panelChannelId);

  const embed = new EmbedBuilder()
    .setTitle("💎 VIP ACCESS")
    .setDescription("Clique pour devenir VIP (4,99€)")
    .setColor(0xff4da6);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("buy_vip")
      .setLabel("💳 Devenir VIP")
      .setStyle(ButtonStyle.Primary)
  );

  await channel.send({ embeds: [embed], components: [row] });
});

// ================= BUTTON CLICK =================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "buy_vip") return;

  // ✅ USER QUI CLIQUE
  const discordId = interaction.user.id;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: "VIP Discord 💎"
            },
            unit_amount: 499
          },
          quantity: 1
        }
      ],
      success_url: "https://discord.com/app",
      cancel_url: "https://discord.com/app",
      metadata: {
        discordId
      }
    });

    return interaction.reply({
      ephemeral: true,
      content: "💳 Clique pour finaliser ton paiement",
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel("Payer VIP")
            .setStyle(ButtonStyle.Link)
            .setURL(session.url)
        )
      ]
    });
  } catch (err) {
    console.log("Stripe error:", err.message);
    return interaction.reply({
      content: "Erreur Stripe",
      ephemeral: true
    });
  }
});

// ================= START SERVER =================
app.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});

client.login(process.env.TOKEN);
