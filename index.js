import "dotenv/config";
import express from "express";
import Stripe from "stripe";
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextChannel
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
// IMPORTANT: webhook raw BEFORE json parser
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.log("Webhook error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ================= PAYMENT SUCCESS =================
  if (event.type === "checkout.session.completed") {
    const discordId = event.data.object.metadata?.discordId;
    console.log("PAYMENT SUCCESS FOR:", discordId);

    if (!discordId) {
      console.log("No discordId in metadata");
      return res.json({ received: true });
    }

    try {
      const guild = await client.guilds.fetch(config.guildId);
      const member = await guild.members.fetch(discordId).catch(() => null);
      
      if (!member) {
        console.log("Member not found:", discordId);
        return res.json({ received: true });
      }

      const vipRole = guild.roles.cache.get(config.vipRoleId);
      if (vipRole) {
        await member.roles.add(vipRole);
        console.log("Role added to:", discordId);
      } else {
        console.log("VIP role not found");
      }

      const channel = await guild.channels.fetch(config.panelChannelId);
      if (channel instanceof TextChannel) {
        await channel.send(`💎 VIP ACTIVÉ : <@${discordId}>`);
      }
    } catch (err) {
      console.log("VIP ERROR:", err.message);
    }
  }

  // Toujours répondre 200 à Stripe pour éviter les retries
  res.json({ received: true });
});

// JSON parser pour les autres routes
app.use(express.json());

// ================= BOT READY =================
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    const channel = await client.channels.fetch(config.panelChannelId);
    
    if (!(channel instanceof TextChannel)) {
      console.log("Panel channel is not a text channel");
      return;
    }

    // Vérifier si un panel existe déjà (optionnel - évite les doublons)
    const messages = await channel.messages.fetch({ limit: 10 });
    const existingPanel = messages.find(m => 
      m.author.id === client.user.id && 
      m.embeds.length > 0 && 
      m.embeds[0].title === "💎 VIP ACCESS"
    );

    if (existingPanel) {
      console.log("Panel already exists, skipping");
      return;
    }

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
    console.log("VIP panel sent successfully");
  } catch (err) {
    console.log("Panel error:", err.message);
  }
});

// ================= BUTTON CLICK =================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "buy_vip") return;

  const discordId = interaction.user.id;

  try {
    await interaction.deferReply({ ephemeral: true });

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

    await interaction.editReply({
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
    
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({
        content: "❌ Erreur lors de la création du paiement. Réessaie plus tard."
      }).catch(() => {});
    } else {
      await interaction.reply({
        content: "❌ Erreur Stripe",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

client.login(process.env.TOKEN);
