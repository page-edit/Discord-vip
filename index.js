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

const config = {
  guildId: "1520354094399750144",
  vipRoleId: "1521573014309834822",
  newbieRoleId: "1521575918198325381",
  panelChannelId: "1521560504189845555",
  baseUrl: "https://discord-vip.onrender.com"
};

app.use(express.json());

// ================= STRIPE CHECKOUT =================
app.get("/create-checkout/:discordId", async (req, res) => {
  const discordId = req.params.discordId;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: { name: "VIP Discord 💎" },
            unit_amount: 499
          },
          quantity: 1
        }
      ],
      success_url: "https://discord.com/app",
      cancel_url: "https://discord.com/app",
      metadata: { discordId }
    });

    return res.redirect(303, session.url);
  } catch (err) {
    console.log(err.message);
    return res.status(500).send("Stripe error");
  }
});

// ================= BOT =================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.once("ready", async () => {
  const channel = await client.channels.fetch(config.panelChannelId);

  const embed = new EmbedBuilder()
    .setTitle("💎 VIP ACCESS")
    .setDescription("Clique pour devenir VIP (4,99€)")
    .setColor(0xff4da6);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("buy_vip")
      .setLabel("💳 Payer VIP")
      .setStyle(ButtonStyle.Primary)
  );

  await channel.send({ embeds: [embed], components: [row] });
});

// ================= CLICK HANDLER =================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "buy_vip") return;

  const discordId = interaction.user.id;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "eur",
          product_data: { name: "VIP Discord 💎" },
          unit_amount: 499
        },
        quantity: 1
      }
    ],
    success_url: "https://discord.com/app",
    cancel_url: "https://discord.com/app",
    metadata: { discordId }
  });

  await interaction.reply({
    content: "💳 Clique pour payer ton VIP",
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("Payer maintenant")
          .setStyle(ButtonStyle.Link)
          .setURL(session.url)
      )
    ],
    ephemeral: true
  });
});

// ================= WEBHOOK =================
app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.sendStatus(400);
  }

  if (event.type === "checkout.session.completed") {
    const discordId = event.data.object.metadata.discordId;

    const guild = await client.guilds.fetch(config.guildId);
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) return res.sendStatus(404);

    const vipRole = guild.roles.cache.get(config.vipRoleId);
    const newbieRole = guild.roles.cache.get(config.newbieRoleId);

    if (newbieRole) await member.roles.remove(newbieRole).catch(() => {});
    if (vipRole) await member.roles.add(vipRole).catch(() => {});

    const channel = await guild.channels.fetch(config.panelChannelId);
    channel.send(`💎 VIP ACTIVÉ : <@${discordId}>`);
  }

  res.json({ received: true });
});

// ================= START =================
app.listen(process.env.PORT || 3000);
client.login(process.env.TOKEN);
