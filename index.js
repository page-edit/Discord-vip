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
  TextChannel,
  MessageFlags,
  Events
} from "discord.js";

const app = express();

// ================= CONFIG =================
const config = {
  guildId: "1520354094399750144",
  vipRoleId: "1521573014309834822",
  panelChannelId: "1521560504189845555",
  baseUrl: "https://discord-vip.onrender.com"
};

// ================= STRIPE =================
const stripe = new Stripe(process.env.STRIPE_SECRET, {
  maxNetworkRetries: 3,
  timeout: 30000
});

// ================= DISCORD BOT =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessages
  ]
});

// ================= STOCKAGE EN MÉMOIRE =================
const contactedMembers = new Set();

// ================= EXPRESS =================
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

      try {
        const user = await client.users.fetch(discordId);
        await user.send("🎉 **VIP activé !** Tu as maintenant accès au rôle VIP sur le serveur.");
      } catch (dmErr) {
        console.log("DM failed:", dmErr.message);
      }

      const channel = await guild.channels.fetch(config.panelChannelId);
      if (channel instanceof TextChannel) {
        await channel.send(`💎 VIP ACTIVÉ : <@${discordId}>`);
      }
    } catch (err) {
      console.log("VIP ERROR:", err.message);
    }
  }

  res.json({ received: true });
});

app.use(express.json());

// ================= FONCTION : ENVOYER LE MP VIP =================
async function sendVIPMessage(member) {
  if (contactedMembers.has(member.id)) {
    console.log(`ℹ️ ${member.user.tag} déjà contacté, skip`);
    return;
  }

  try {
    const embed = new EmbedBuilder()
      .setTitle("💎 VIP ACCESS")
      .setDescription("Bienvenue ! Deviens VIP pour seulement **4,99€** et accède à des avantages exclusifs.")
      .setColor(0xff4da6)
      .setFooter({ text: "Clique sur le bouton ci-dessous pour payer" });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("buy_vip")
        .setLabel("💳 Devenir VIP - 4,99€")
        .setStyle(ButtonStyle.Primary)
    );

    await member.send({ embeds: [embed], components: [row] });
    contactedMembers.add(member.id);
    console.log(`✅ MP VIP envoyé à ${member.user.tag}`);
  } catch (err) {
    console.log(`❌ MP impossible pour ${member.user.tag}:`, err.message);
  }
}

// ================= NOUVEAU MEMBRE =================
client.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild.id !== config.guildId) return;
  console.log(`👋 Nouveau membre : ${member.user.tag} (${member.id})`);
  await sendVIPMessage(member);
});

// ================= BOT READY : RATTRAPAGE =================
client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot connecté : ${client.user.tag}`);
  console.log(`📋 Guild ID : ${config.guildId}`);
  console.log(`💎 Role ID : ${config.vipRoleId}`);
  console.log(`📢 Channel ID : ${config.panelChannelId}`);

  try {
    const guild = await client.guilds.fetch(config.guildId);
    console.log(`🏰 Serveur trouvé : ${guild.name}`);

    const vipRole = guild.roles.cache.get(config.vipRoleId);
    console.log(vipRole ? `✅ Rôle VIP trouvé : ${vipRole.name}` : `❌ Rôle VIP INTROUVABLE`);

    const channel = await guild.channels.fetch(config.panelChannelId);
    console.log(channel ? `✅ Salon trouvé : ${channel.name}` : `❌ Salon INTROUVABLE`);

    console.log("🔍 Rattrapage : envoi aux membres sans VIP...");

    const members = await guild.members.fetch();
    let sentCount = 0;
    let skippedCount = 0;

    for (const [id, member] of members) {
      if (member.user.bot) continue;
      if (member.roles.cache.has(config.vipRoleId)) {
        skippedCount++;
        continue;
      }
      if (contactedMembers.has(id)) {
        skippedCount++;
        continue;
      }

      await sendVIPMessage(member);
      sentCount++;
      await new Promise(r => setTimeout(r, 500));
    }

    console.log(`📊 Rattrapage terminé : ${sentCount} MP envoyés, ${skippedCount} ignorés`);

    if (channel instanceof TextChannel) {
      const messages = await channel.messages.fetch({ limit: 10 });
      const existingPanel = messages.find(m =>
        m.author.id === client.user.id &&
        m.embeds.length > 0 &&
        m.embeds[0].title === "💎 VIP ACCESS"
      );

      if (!existingPanel) {
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
        console.log("✅ Panel envoyé dans le salon");
      } else {
        console.log("ℹ️ Panel déjà présent dans le salon");
      }
    }
  } catch (err) {
    console.log("❌ ERREUR READY:", err.message);
  }
});

// ================= BUTTON CLICK - CORRIGÉ =================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "buy_vip") return;

  const discordId = interaction.user.id;

  try {
    // ✅ CORRECTION : reply immédiate pour éviter "Échec de l'interaction"
    // On envoie d'abord un message temporaire, puis on met à jour
    await interaction.reply({
      content: "⏳ Création du lien de paiement...",
      flags: MessageFlags.Ephemeral
    });

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
      metadata: { discordId }
    });

    // ✅ Met à jour le message avec le vrai lien
    await interaction.editReply({
      content: "💳 Clique pour finaliser ton paiement",
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel("Payer VIP - 4,99€")
            .setStyle(ButtonStyle.Link)
            .setURL(session.url)
        )
      ]
    });
  } catch (err) {
    console.log("Stripe error:", err.message);
    console.log("Stripe error type:", err.type);
    console.log("Stripe error code:", err.code);

    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({
        content: "❌ Erreur lors de la création du paiement. Réessaie plus tard."
      }).catch(() => {});
    } else {
      await interaction.reply({
        content: "❌ Erreur Stripe",
        flags: MessageFlags.Ephemeral
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
