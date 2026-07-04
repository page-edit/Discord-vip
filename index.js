require("dotenv").config();
const express = require("express");
const Stripe = require("stripe");
const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextChannel,
  MessageFlags,
  Events
} = require("discord.js");

const app = express();

// ================= CONFIG =================
const config = {
  guildId: "1520354094399750144",
  vipRoleId: "1521573014309834822",
  panelChannelId: "1521560504189845555",
  baseUrl: "https://discord-vip.onrender.com",
  kickDelayMs: 2 * 60 * 60 * 1000,
  warningDelayMs: 1 * 60 * 60 * 1000
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

// ================= PERSISTANCE FICHIER =================
const CONTACTED_FILE = path.join(__dirname, "contacted.json");

function loadContacted() {
  try {
    if (fs.existsSync(CONTACTED_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONTACTED_FILE, "utf8"));
      return new Set(data);
    }
  } catch (err) {
    console.log("Erreur chargement contacted.json:", err.message);
  }
  return new Set();
}

function saveContacted() {
  try {
    fs.writeFileSync(CONTACTED_FILE, JSON.stringify([...contactedMembers]), "utf8");
  } catch (err) {
    console.log("Erreur sauvegarde contacted.json:", err.message);
  }
}

const contactedMembers = loadContacted();
const pendingPayments = new Map();

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
    return res.status(400).send("Webhook Error: " + err.message);
  }

  if (event.type === "checkout.session.completed") {
    const discordId = event.data.object.metadata?.discordId;
    console.log("PAYMENT SUCCESS FOR:", discordId);

    if (!discordId) {
      console.log("No discordId in metadata");
      return res.json({ received: true });
    }

    const pending = pendingPayments.get(discordId);
    if (pending) {
      clearTimeout(pending.warningTimerId);
      clearTimeout(pending.kickTimerId);
      pendingPayments.delete(discordId);
      console.log("Timers annules pour " + discordId + " (paiement recu)");
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
        await user.send("🎉 **VIP active !** Tu as maintenant acces au role VIP sur le serveur.");
      } catch (dmErr) {
        console.log("DM failed:", dmErr.message);
      }

      const channel = await guild.channels.fetch(config.panelChannelId);
      if (channel instanceof TextChannel) {
        await channel.send("💎 VIP ACTIVE : <@" + discordId + ">");
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
    console.log(member.user.tag + " deja contacte, skip");
    return false;
  }

  try {
    const embed = new EmbedBuilder()
      .setTitle("💎 VIP ACCESS")
      .setDescription("Bienvenue ! Deviens VIP pour seulement **4,99€** et accede a des avantages exclusifs.")
      .setColor(0xff4da6)
      .setFooter({ text: "⚠️ Tu as 2 heures pour payer, sinon tu seras exclu du serveur." });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("buy_vip")
        .setLabel("💳 Devenir VIP - 4,99€")
        .setStyle(ButtonStyle.Primary)
    );

    await member.send({ embeds: [embed], components: [row] });
    contactedMembers.add(member.id);
    saveContacted();
    console.log("MP VIP envoye a " + member.user.tag);
    return true;
  } catch (err) {
    console.log("MP impossible pour " + member.user.tag + ":", err.message);
    return false;
  }
}

// ================= FONCTION : AVERTISSEMENT A 1H =================
function scheduleWarning(member) {
  const warningTimerId = setTimeout(async () => {
    try {
      const pending = pendingPayments.get(member.id);
      if (!pending) return;

      const guild = await client.guilds.fetch(config.guildId);
      const currentMember = await guild.members.fetch(member.id).catch(() => null);

      if (!currentMember) {
        console.log(member.user.tag + " deja parti");
        pendingPayments.delete(member.id);
        return;
      }

      if (currentMember.roles.cache.has(config.vipRoleId)) {
        console.log(member.user.tag + " a deja le VIP");
        pendingPayments.delete(member.id);
        return;
      }

      try {
        const embed = new EmbedBuilder()
          .setTitle("⏰ Plus qu'1 heure !")
          .setDescription("Tu n'as toujours pas paye ton acces VIP. Il te reste **1 heure** avant d'etre exclu du serveur.")
          .setColor(0xffaa00)
          .setFooter({ text: "Clique sur le bouton ci-dessous pour payer maintenant" });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("buy_vip")
            .setLabel("💳 Payer VIP - 4,99€")
            .setStyle(ButtonStyle.Primary)
        );

        await currentMember.send({ embeds: [embed], components: [row] });
        console.log("Avertissement envoye a " + member.user.tag);
      } catch (dmErr) {
        console.log("DM avertissement impossible:", dmErr.message);
      }
    } catch (err) {
      console.log("Erreur avertissement " + member.user.tag + ":", err.message);
    }
  }, config.warningDelayMs);

  return warningTimerId;
}

// ================= FONCTION : KICK A 2H =================
function scheduleKick(member) {
  const existing = pendingPayments.get(member.id);
  if (existing) {
    clearTimeout(existing.warningTimerId);
    clearTimeout(existing.kickTimerId);
    console.log("Anciens timers annules pour " + member.user.tag);
  }

  const warningTimerId = scheduleWarning(member);

  const kickTimerId = setTimeout(async () => {
    try {
      const guild = await client.guilds.fetch(config.guildId);
      const currentMember = await guild.members.fetch(member.id).catch(() => null);

      if (!currentMember) {
        console.log(member.user.tag + " deja parti");
        pendingPayments.delete(member.id);
        return;
      }

      if (currentMember.roles.cache.has(config.vipRoleId)) {
        console.log(member.user.tag + " a deja le VIP, kick annule");
        pendingPayments.delete(member.id);
        return;
      }

      try {
        await currentMember.send("⏰ **Temps ecoule !** Tu n'as pas paye dans les 2 heures. Tu vas etre exclu du serveur.");
      } catch (dmErr) {
        console.log("DM kick warning failed:", dmErr.message);
      }

      await currentMember.kick("Paiement non recu dans les 2 heures");
      console.log(member.user.tag + " KICKE");

      const channel = await guild.channels.fetch(config.panelChannelId);
      if (channel instanceof TextChannel) {
        await channel.send("🚫 **" + member.user.tag + "** a ete exclu (paiement non recu)");
      }

      pendingPayments.delete(member.id);
    } catch (err) {
      console.log("Erreur kick " + member.user.tag + ":", err.message);
      pendingPayments.delete(member.id);
    }
  }, config.kickDelayMs);

  pendingPayments.set(member.id, {
    joinTimestamp: Date.now(),
    warningTimerId,
    kickTimerId
  });

  console.log("Avertissement dans 1h + Kick dans 2h pour " + member.user.tag);
}

// ================= NOUVEAU MEMBRE (en temps reel) =================
client.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild.id !== config.guildId) return;
  console.log("Nouveau membre (temps reel) : " + member.user.tag);

  const sent = await sendVIPMessage(member);
  if (sent) {
    scheduleKick(member);
  }
});

// ================= RATTRAPAGE AU DEMARRAGE =================
async function runCatchUp() {
  console.log("=== RATTRAPAGE DEMARRE ===");
  
  try {
    const guild = await client.guilds.fetch(config.guildId);
    const members = await guild.members.fetch();
    
    let sentCount = 0;
    let skippedCount = 0;
    let vipCount = 0;
    
    for (const [id, member] of members) {
      if (member.user.bot) {
        skippedCount++;
        continue;
      }
      
      if (member.roles.cache.has(config.vipRoleId)) {
        vipCount++;
        skippedCount++;
        continue;
      }
      
      if (contactedMembers.has(id)) {
        skippedCount++;
        continue;
      }
      
      // Nouveau membre non contacte : envoyer MP + timer
      const sent = await sendVIPMessage(member);
      if (sent) {
        scheduleKick(member);
        sentCount++;
      }
      
      // Petit delai pour eviter le rate limit
      await new Promise(r => setTimeout(r, 500));
    }
    
    console.log("=== RATTRAPAGE TERMINE ===");
    console.log("Envoyes: " + sentCount + " | Skipped (deja contacte/VIP/bot): " + skippedCount + " | VIP: " + vipCount);
    
  } catch (err) {
    console.log("ERREUR RATTRAPAGE:", err.message);
  }
}

// ================= BOT READY =================
client.once(Events.ClientReady, async () => {
  console.log("Bot connecte : " + client.user.tag);

  try {
    const guild = await client.guilds.fetch(config.guildId);
    console.log("Serveur : " + guild.name);

    const vipRole = guild.roles.cache.get(config.vipRoleId);
    console.log(vipRole ? "Role VIP : " + vipRole.name : "Role VIP INTROUVABLE");

    const channel = await guild.channels.fetch(config.panelChannelId);
    console.log(channel ? "Salon : " + channel.name : "Salon INTROUVABLE");

    console.log("Membres deja contactes (persistes) : " + contactedMembers.size);

    // Rattrapage : contacte uniquement les nouveaux arrivants pendant le offline
    await runCatchUp();

    // Panel dans le salon (envoye une seule fois)
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
        console.log("Panel envoye");
      }
    }
  } catch (err) {
    console.log("ERREUR READY:", err.message);
  }
});

// ================= BUTTON CLICK =================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "buy_vip") return;

  const discordId = interaction.user.id;

  try {
    await interaction.reply({
      content: "⏳ Creation du lien de paiement...",
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

    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({
        content: "❌ Erreur lors de la creation du paiement."
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
  console.log("Server running on port " + PORT);
});

client.login(process.env.TOKEN);
