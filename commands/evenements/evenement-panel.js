const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const Prompt = require('../../framework_utils/Prompt.js');
const evenement = require('./evenement.js');
const config = require('../../config.json');

module.exports = {
	data: new SlashCommandBuilder().setName('evenement-panel').setDescription('Envoie le panel de création d’évènements.'),
	async execute(interaction) {
		if (!interaction.member?.permissions?.has('Administrator')) return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('Accès refusé').setDescription('Cette commande est réservée aux administrateurs.')], flags: MessageFlags.Ephemeral });
		const channel = await interaction.client.channels.fetch(config.eventPanelChannelId).catch(() => null);
		if (!channel?.isTextBased()) return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('Configuration invalide').setDescription('Le salon du panel évènement est absent ou mal configuré.')], flags: MessageFlags.Ephemeral });
		await evenement.createPanel(channel);
		await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('Panel envoyé')], flags: MessageFlags.Ephemeral });
	},
	async restore(client) {
		if (!config.eventPanelChannelId) return;
		for (const guild of client.guilds.cache.values()) {
			const channel = await guild.channels.fetch(config.eventPanelChannelId).catch(() => null);
			if (!channel?.isTextBased()) continue;
			const messages = await channel.messages.fetch({ limit: 100 });
			for (const message of messages.values()) if (Prompt.readMetadata(message)?.type === 'event-panel') await evenement.attachPanel(message);
		}
	},
};