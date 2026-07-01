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
  newbieRoleId: "1521575918198325381",
  panelChannelId: "1521560504189845555"
};

// ================= STRIPE WEBHOOK =================
app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  let event;

  try {
    const signature = req.headers["stripe-signature"];

    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.log("❌ Webhook error:", err.message);
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
      } catch (err) {
        console.log("VIP error:", err);
      }
    })();
  }

  res.json({ received: true });
});

app.use(express.json());

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

    const messages = await channel.messages.fetch({ limit: 10 });

    const alreadyExists = messages.find(m =>
      m.author.id === client.user.id &&
      m.embeds.length > 0 &&
      m.embeds[0].title?.includes("VIP ACCESS")
    );

    if (alreadyExists) {
      console.log("ℹ️ VIP panel already exists");
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("💎 VIP ACCESS ❤️🫦")
      .setDescription("Clique ici pour devenir VIP (4,99€)")
      .setColor(0xff4da6);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("❤️ Devenir VIP")
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord-vip.onrender.com/create-checkout/${config.guildId}`)
    );

    const msg = await channel.send({
      embeds: [embed],
      components: [row]
    });

    await msg.pin().catch(() => {});
  } catch (err) {
    console.log("Panel error:", err);
  }
});

// ================= STRIPE CHECKOUT =================
app.get("/create-checkout/:discordId", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: "VIP Discord ❤️🫦"
            },
            unit_amount: 499
          },
          quantity: 1
        }
      ],
      success_url: "https://discord.com/channels/@me",
      cancel_url: "https://discord.com",
      metadata: {
        discordId: req.params.discordId
      }
    });

    return res.redirect(session.url);
  } catch (err) {
    console.log("Stripe error:", err);
    return res.status(500).send("Stripe error");
  }
});

// ================= START SERVER =================
app.listen(process.env.PORT || 3000, () => {
  console.log("🌐 Server running");
});

client.login(process.env.TOKEN);
