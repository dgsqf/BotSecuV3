const {
	SlashCommandBuilder,
	MessageFlags,
	ButtonStyle,
	EmbedBuilder,
} = require('discord.js');
const Prompt = require('../../framework_utils/Prompt.js');
const rapports = require('./rapports.js');
const { rapportPanelChannelId } = require('../../config.json');

const PANEL_ROLE_ID = '1542836944457703454';

const createReportPanel = () => new Prompt({
	title: 'Rapports de sécurité',
	description: 'Cliquez sur le bouton ci-dessous pour ouvrir un rapport. \n**ATTENTION :** Ne gardez pas un formulaire de création de rapportouvert pour plus de 15 minutes, celui-ci expirera.',
	color: 0x5865f2,
	metadata: { type: 'rapport-panel' },
	buttons: [
		{
			customId: 'rapport:open-form',
			label: 'Ouvrir un rapport',
			style: ButtonStyle.Primary,
			cooldown: 60,
			callback: (buttonInteraction) => rapports.startReport(buttonInteraction),
		},
	],
});

const getPanelChannel = async (guild, client) => {
	if (!rapportPanelChannelId) return null;
	try {
		const channel = await guild.channels.fetch(rapportPanelChannelId);
		return channel?.isTextBased() ? channel : null;
	}
	catch (error) {
		await client.log('RAPPORT PANEL', 'ERROR', `Impossible de récupérer le salon du panel de rapports: ${error.stack || error}`);
		return null;
	}
};

module.exports = {
	cooldown: 600,
	data: new SlashCommandBuilder()
		.setName('rapport-panel')
		.setDescription('Envoie le panel permettant d’ouvrir un rapport.'),
	async execute(interaction) {
		if (!interaction.member.roles.cache.has(PANEL_ROLE_ID)) {
			return interaction.reply({
				embeds: [new EmbedBuilder()
					.setColor(0xFF0000)
					.setTitle('Accès refusé')
					.setDescription('Vous devez posséder le rôle requis pour utiliser cette commande.')],
				flags: MessageFlags.Ephemeral,
			});
		}

		const channel = await getPanelChannel(interaction.guild, interaction.client);
		if (!channel) {
			return interaction.reply({
				embeds: [new EmbedBuilder()
					.setColor(0xed4245)
					.setTitle('Configuration invalide')
					.setDescription('Le salon du panel de rapports est absent ou mal configuré dans config.json.')],
				flags: MessageFlags.Ephemeral,
			});
		}

		await createReportPanel().send(channel);
		await interaction.reply({
			embeds: [new EmbedBuilder()
				.setColor(0x00FF00)
				.setTitle('Panel envoyé')
				.setDescription(`Le panel de rapports a été envoyé dans ${channel}.`)],
			flags: MessageFlags.Ephemeral,
		});
	},
	async restore(client) {
		if (!rapportPanelChannelId) return;
		for (const guild of client.guilds.cache.values()) {
			const channel = await getPanelChannel(guild, client);
			if (!channel) continue;
			const messages = await channel.messages.fetch({ limit: 100 });
			for (const message of messages.values()) {
				if (Prompt.readMetadata(message)?.type !== 'rapport-panel') continue;
				await createReportPanel().attach(message);
			}
		}
	},
};
