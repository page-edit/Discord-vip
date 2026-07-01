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

// ================= EXPRESS =================
app.get("/", (req, res) => {
  res.send("💎 VIP BOT ONLINE");
});

// Stripe webhook must be raw
app.use("/webhook", express.raw({ type: "*/*" }));
app.use(express.json());

// ================= STRIPE CHECKOUT =================
app.get("/create-checkout", async (req, res) => {
  try {
    const discordId = req.query.discordId;

    if (!discordId) {
      return res.status(400).send("Missing discordId");
    }

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
      success_url: "https://discord.com",
      cancel_url: "https://discord.com",
      metadata: {
        discordId
      }
    });

    res.redirect(303, session.url);
  } catch (err) {
    console.log("Stripe error:", err.message);
    res.status(500).send("Stripe error");
  }
});

// ================= WEBHOOK STRIPE =================
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
    console.log("Webhook error:", err.message);
    return res.sendStatus(400);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const discordId = session.metadata?.discordId;

    if (!discordId) return res.sendStatus(400);

    (async () => {
      try {
        const guild = await client.guilds.fetch(config.guildId);

        const member = await guild.members.fetch({
          user: discordId,
          force: true
        });

        const vipRole = guild.roles.cache.get(config.vipRoleId);
        const newbieRole = guild.roles.cache.get(config.newbieRoleId);

        if (newbieRole) await member.roles.remove(newbieRole).catch(() => {});
        if (vipRole) await member.roles.add(vipRole).catch(() => {});

        const channel = await guild.channels.fetch(config.panelChannelId);
        channel.send(`💎 VIP ACTIVÉ : <@${discordId}>`);
      } catch (err) {
        console.log("VIP ERROR:", err.message);
      }
    })();
  }

  res.json({ received: true });
});

// ================= DISCORD BOT =================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    const channel = await client.channels.fetch(config.panelChannelId);

    const embed = new EmbedBuilder()
      .setTitle("💎 VIP ACCESS")
      .setDescription("Clique pour devenir VIP (4,99€)")
      .setColor(0xff4da6);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("Devenir VIP")
        .setStyle(ButtonStyle.Link)
        .setURL(
          `https://discord-vip.onrender.com/create-checkout?discordId=1521346062546374797`
        )
    );

    channel.send({ embeds: [embed], components: [row] });
  } catch (err) {
    console.log("Panel error:", err.message);
  }
});

// ================= START =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});

client.login(process.env.TOKEN);
