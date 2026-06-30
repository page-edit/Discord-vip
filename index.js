import "dotenv/config";
import express from "express";
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from "discord.js";

import config from "./config.json" assert { type: "json" };
import { createCheckout, verifyWebhook } from "./stripe.js";

const app = express();
app.use(express.json());

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// ===================== BOT READY =====================
client.once("ready", async () => {
  console.log(`✅ Connecté: ${client.user.tag}`);

  const channel = await client.channels.fetch(config.panelChannelId);

  const embed = new EmbedBuilder()
    .setTitle("💎 VIP ACCESS ❤️🫦")
    .setDescription("Accès VIP disponible — 4,99€")
    .setColor(0xff4da6);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("❤️ Devenir VIP")
      .setStyle(ButtonStyle.Primary)
      .setCustomId("buy_vip"),

    new ButtonBuilder()
      .setLabel("📜 Règlement")
      .setStyle(ButtonStyle.Secondary)
      .setCustomId("rules")
  );

  channel.send({ embeds: [embed], components: [row] });
});

// ===================== JOIN =====================
client.on("guildMemberAdd", async (member) => {
  if (member.guild.id !== config.guildId) return;

  const role = member.guild.roles.cache.get(config.newbieRoleId);
  if (role) await member.roles.add(role);

  const channel = await member.guild.channels.fetch(config.panelChannelId);
  channel.send(`👋 ${member.user.tag} a rejoint.`);
});

// ===================== INTERACTION BUTTON =====================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === "buy_vip") {
    const url = await createCheckout(interaction.user.id);

    return interaction.reply({
      content: `💳 Clique ici pour payer ton VIP : ${url}`,
      ephemeral: true
    });
  }

  if (interaction.customId === "rules") {
    return interaction.reply({
      content: "📜 Règlement : respect, pas de spam, pas d'abus.",
      ephemeral: true
    });
  }
});

// ===================== STRIPE WEBHOOK =====================
app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  let event;

  try {
    event = verifyWebhook(req.body, req.headers["stripe-signature"]);
  } catch (err) {
    console.log("Webhook invalide");
    return res.sendStatus(400);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const discordId = session.metadata.discordId;

    (async () => {
      const guild = await client.guilds.fetch(config.guildId);
      const member = await guild.members.fetch(discordId);

      const vip = guild.roles.cache.get(config.vipRoleId);
      const newbie = guild.roles.cache.get(config.newbieRoleId);

      if (newbie) await member.roles.remove(newbie);
      if (vip) await member.roles.add(vip);

      const channel = await guild.channels.fetch(config.panelChannelId);
      channel.send(`💎 VIP ACTIVÉ : <@${discordId}>`);
    })();
  }

  res.json({ received: true });
});

// ===================== START =====================
app.listen(process.env.PORT || 3000, () =>
  console.log("🌐 Webhook actif")
);

client.login(process.env.TOKEN);
