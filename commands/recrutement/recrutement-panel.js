const {
	SlashCommandBuilder,
	MessageFlags,
	ButtonStyle,
	EmbedBuilder,
} = require('discord.js');
const Prompt = require('../../framework_utils/Prompt.js');
const recrutement = require('./recrutement.js');
const { recruitmentPanelChannelId } = require('../../config.json');

const createRecruitmentPanel = () => new Prompt({
	title: 'Recrutement - Département de la sécurité',
	description: 'Vous souhaitez rejoindre le département de la sécurité ? Cliquez sur le bouton ci-dessous pour remplir le formulaire de recrutement.',
	color: 0x0099ff,
	metadata: { type: 'recruitment-panel' },
	buttons: [
		{
			customId: 'recruitment:open-form',
			label: 'Ouvrir le formulaire',
			style: ButtonStyle.Primary,
			cooldown: 10,
			callback: (buttonInteraction) => recrutement.execute(buttonInteraction),
		},
	],
});

const getPanelChannel = async (guild) => {
	if (!recruitmentPanelChannelId || recruitmentPanelChannelId === 'REMPLACEZ_PAR_L_ID_DU_SALON') return null;
	try {
		const channel = await guild.channels.fetch(recruitmentPanelChannelId);
		return channel?.isTextBased() ? channel : null;
	}
	catch (error) {
		if (error?.code === 'GuildChannelUnowned' || error?.code === 50001) return null;
		throw error;
	}
};

module.exports = {
	cooldown: 10,
	data: new SlashCommandBuilder()
		.setName('recrutement-panel')
		.setDescription('Envoie le panel du formulaire de recrutement dans le salon configuré.'),
	async execute(interaction) {
		const REQUIRED_ROLE_ID = '1542836944457703454';

		// Step 1: Check if the user (interaction.member) has the required role
		if (!interaction.member.roles.cache.has(REQUIRED_ROLE_ID)) {
			denied_access_embed = new EmbedBuilder()
				.setColor(0xFF0000)
				.setTitle('Accès refusé')
				.setDescription('Vous devez posséder le rôle "IRA - 8 : Direction" pour utiliser cette commande.');
			// Authorization Failure
			await interaction.reply({
				embeds: [denied_access_embed],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		let channel;
		try {
			channel = await getPanelChannel(interaction.guild);
		}
		catch (error) {
			console.error('[RECRUTEMENT PANEL] Impossible de récupérer le salon configuré:', error);
		}

		if (!channel) {
			return interaction.reply({
				embeds: [new EmbedBuilder()
					.setColor(0xed4245)
					.setTitle('Configuration invalide')
					.setDescription('Le salon du panel de recrutement est absent ou mal configuré dans config.json.')],
				flags: MessageFlags.Ephemeral,
			});
		}

		await createRecruitmentPanel().send(channel);
		panel_sent_embed = new EmbedBuilder()
			.setColor(0x00FF00)
			.setTitle('Panel envoyé')
			.setDescription(`Le panel de recrutement a été envoyé dans ${channel}.`);
		await interaction.reply({
			embeds: [panel_sent_embed],
			flags: MessageFlags.Ephemeral,
		});
	},
	async restore(client) {
		if (!recruitmentPanelChannelId || recruitmentPanelChannelId === 'REMPLACEZ_PAR_L_ID_DU_SALON') return;

		for (const guild of client.guilds.cache.values()) {
			let channel;
			try {
				channel = await getPanelChannel(guild);
			}
			catch (error) {
				console.error('[RECRUTEMENT PANEL] Impossible de restaurer le panel:', error);
				continue;
			}

			if (!channel) continue;
			const messages = await channel.messages.fetch({ limit: 100 });
			for (const message of messages.values()) {
				const metadata = Prompt.readMetadata(message);
				if (metadata?.type !== 'recruitment-panel') continue;
				await createRecruitmentPanel().attach(message);
			}
		}
	},
};