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
import fs from "fs";

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET);

// ⚠️ Webhook Stripe doit être RAW
app.use("/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

// CONFIG (si tu as config.json)
const config = JSON.parse(fs.readFileSync("./config.json", "utf8"));

// ================= DISCORD =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  try {
    const channel = await client.channels.fetch(config.panelChannelId);

    const embed = new EmbedBuilder()
      .setTitle("💎 VIP ACCESS ❤️🫦")
      .setDescription("Accès VIP 4,99€")
      .setColor(0xff4da6);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("❤️ Devenir VIP")
        .setStyle(ButtonStyle.Link)
        .setURL("https://buy.stripe.com/4gM4gy5i0gA21JVff8ew80h")
    );

    channel.send({ embeds: [embed], components: [row] });
  } catch (e) {
    console.log("Panel error:", e);
  }
});

// ================= JOIN =================
client.on("guildMemberAdd", async (member) => {
  if (member.guild.id !== config.guildId) return;

  try {
    const role = member.guild.roles.cache.get(config.newbieRoleId);
    if (role) await member.roles.add(role);
  } catch (e) {
    console.log("Join error:", e);
  }
});

// ================= STRIPE WEBHOOK =================
app.post("/webhook", (req, res) => {
  let event;

  try {
    const signature = req.headers["stripe-signature"];

    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.log("❌ Webhook error");
    return res.sendStatus(400);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const discordId = session.metadata?.discordId;

    (async () => {
      try {
        const guild = await client.guilds.fetch(config.guildId);
        const member = await guild.members.fetch(discordId);

        const vip = guild.roles.cache.get(config.vipRoleId);
        const newbie = guild.roles.cache.get(config.newbieRoleId);

        if (newbie) await member.roles.remove(newbie);
        if (vip) await member.roles.add(vip);

        const channel = await guild.channels.fetch(config.panelChannelId);
        channel.send(`💎 VIP ACTIVÉ : <@${discordId}>`);
      } catch (e) {
        console.log("VIP error:", e);
      }
    })();
  }

  res.json({ received: true });
});

// ================= START SERVER =================
app.listen(process.env.PORT || 3000, () => {
  console.log("🌐 Server running");
});

client.login(process.env.TOKEN);
