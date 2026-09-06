const {
	SlashCommandBuilder,
	MessageFlags,
	ButtonStyle,
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
		let channel;
		try {
			channel = await getPanelChannel(interaction.guild);
		}
		catch (error) {
			console.error('[RECRUTEMENT PANEL] Impossible de récupérer le salon configuré:', error);
		}

		if (!channel) {
			return interaction.reply({
				content: 'Le salon du panel de recrutement est absent ou mal configuré dans config.json.',
				flags: MessageFlags.Ephemeral,
			});
		}

		await createRecruitmentPanel().send(channel);
		return interaction.reply({
			content: `Le panel de recrutement a été envoyé dans ${channel}.`,
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