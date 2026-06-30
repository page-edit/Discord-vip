'use strict';

const {
  Client,
  GatewayIntentBits,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionsBitField
} = require('discord.js');

const config = require('./config.json');
const { createCheckoutSession } = require('./stripe.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

const BUY_BUTTON_ID = 'vip_buy';
const RULES_BUTTON_ID = 'vip_rules';

client.once(Events.ClientReady, async (c) => {
  console.log(`[DISCORD] Connecté en tant que ${c.user.tag}`);
  try {
    await sendOrRefreshPanel(c);
  } catch (err) {
    console.error('[DISCORD] Erreur lors de l\'envoi du panel:', err);
  }
});

/**
 * Envoie le panel VIP dans le salon configuré.
 */
async function sendOrRefreshPanel(c) {
  const channel = await c.channels.fetch(config.panelChannelId).catch((err) => {
    console.error('[DISCORD] Impossible de récupérer le salon panel:', err.message);
    return null;
  });

  if (!channel || !channel.isTextBased()) {
    console.error('[DISCORD] Salon panel introuvable ou non textuel. Vérifie panelChannelId dans config.json.');
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(config.panelTitle || '🔥 Accès VIP')
    .setDescription(config.panelDescription || 'Débloque l\'accès VIP du serveur.')
    .setColor(0xffd700);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BUY_BUTTON_ID)
      .setLabel('Devenir VIP ❤️')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(RULES_BUTTON_ID)
      .setLabel('Règlement')
      .setStyle(ButtonStyle.Secondary)
  );

  await channel.send({ embeds: [embed], components: [row] });
  console.log('[DISCORD] Panel VIP envoyé avec succès.');
}

// Attribution du rôle newbie à l'arrivée d'un membre
client.on(Events.GuildMemberAdd, async (member) => {
  try {
    if (!config.newbieRoleId) return;
    await member.roles.add(config.newbieRoleId);
    console.log(`[DISCORD] Rôle newbie attribué à ${member.user.tag}`);
  } catch (err) {
    console.error(`[DISCORD] Erreur attribution rôle newbie pour ${member.user.tag}:`, err.message);
  }
});

// Gestion des interactions (boutons)
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  try {
    if (interaction.customId === BUY_BUTTON_ID) {
      await handleBuyButton(interaction);
    } else if (interaction.customId === RULES_BUTTON_ID) {
      await handleRulesButton(interaction);
    }
  } catch (err) {
    console.error('[DISCORD] Erreur traitement interaction:', err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({
        content: '❌ Une erreur est survenue. Réessaie plus tard ou contacte le staff.'
      }).catch(() => {});
    } else {
      await interaction.reply({
        content: '❌ Une erreur est survenue. Réessaie plus tard ou contacte le staff.',
        ephemeral: true
      }).catch(() => {});
    }
  }
});

async function handleBuyButton(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const session = await createCheckoutSession(
    interaction.user.id,
    interaction.user.username
  );

  if (!session || !session.url) {
    await interaction.editReply({
      content: '❌ Impossible de générer le lien de paiement. Réessaie plus tard.'
    });
    return;
  }

  const payRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('💳 Payer 4.99€')
      .setStyle(ButtonStyle.Link)
      .setURL(session.url)
  );

  await interaction.editReply({
    content: 'Clique sur le bouton ci-dessous pour finaliser ton paiement sécurisé via Stripe.',
    components: [payRow]
  });
}

async function handleRulesButton(interaction) {
  const embed = new EmbedBuilder()
    .setDescription(config.reglementText || 'Aucun règlement défini.')
    .setColor(0x2b2d31);

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * Attribue le rôle VIP et retire le rôle newbie pour un discordId donné.
 * Appelé depuis le webhook Stripe après paiement validé.
 * @param {string} discordId
 */
async function grantVipAccess(discordId) {
  const guild = await client.guilds.fetch(config.guildId);
  if (!guild) {
    throw new Error(`Guild introuvable pour guildId=${config.guildId}`);
  }

  const member = await guild.members.fetch(discordId);
  if (!member) {
    throw new Error(`Membre introuvable pour discordId=${discordId}`);
  }

  const me = await guild.members.fetchMe();
  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    throw new Error('Le bot n\'a pas la permission ManageRoles sur ce serveur.');
  }

  if (config.vipRoleId) {
    await member.roles.add(config.vipRoleId);
  }
  if (config.newbieRoleId && member.roles.cache.has(config.newbieRoleId)) {
    await member.roles.remove(config.newbieRoleId);
  }

  console.log(`[DISCORD] Accès VIP accordé à ${member.user.tag} (${discordId})`);
  return member;
}

module.exports = {
  client,
  grantVipAccess
};
