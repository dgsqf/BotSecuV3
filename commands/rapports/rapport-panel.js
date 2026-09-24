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

const REPORT_PANEL_FIELDS = [
	{
		name: 'I. Types de rapports : patrouille et incident',
		value: '╰─ **Rapport de patrouille**\nLes rapports de patrouille sont équivalents à des prises de service. Vous pouvez en rédiger à chaque fois que vous passez du temps en tant que membre de la sécurité sur le serveur. Ils permettent notamment de montrer votre activité et votre implication au sein du département.\n\n╰─ **Rapport d’incident**\nLes rapports d’incident sont plus rares. Vous devez en rédiger lorsque vous êtes témoin d’une situation inhabituelle. Cela peut aller d’un incident mineur, comme une simple altercation entre deux membres du personnel, à un événement majeur, comme une attaque de grande envergure ou une importante brèche de déconfinement.',
	},
	{
		name: '',
		value: '╰─ **Rapport de personnel**\nLes rapports de personnel peuvent être utilisés en cas de différend avec un membre du personnel, qu’il appartienne à la sécurité ou à l’installation. Vous devez y rapporter l’ensemble des détails dont vous disposez. Si le rapport est jugé pertinent, une enquête pourra être ouverte ou relancée.\n\n╰─ **Rapport d’expérience**\nLorsque vous participez à une expérience, vous devez rédiger un rapport concernant celle-ci et y préciser tous les éléments importants. Vous devez notamment signaler les éventuelles mesures de sécurité qui n’ont pas été respectées par le scientifique, les classes-D ou les autres membres de la sécurité présents avec vous.',
	},
	{
		name: 'II. Consignes de rédaction',
		value: 'Les rapports ne sont pas obligatoires. Cependant, si vous décidez d’en rédiger un, celui-ci doit être clair, complet et précis.\n\nL’utilisation de l’IA est autorisée uniquement pour corriger votre texte et le rendre plus clair. Elle ne doit en aucun cas modifier ou altérer le contenu du rapport.',
	},
	{
		name: 'Informations à relever',
		value: 'Afin de rendre votre rapport aussi précis que possible, pensez à relever un maximum d’informations :\n\n╰─ Les noms des membres du personnel concernés\n╰─ Les dates et heures\n╰─ Les lieux\n╰─ Les faits observés\n╰─ Les circonstances de l’événement\n╰─ Tout autre élément pouvant être pertinent',
	},
	{
		name: 'Utilité des rapports',
		value: 'Plus votre rapport sera précis et complet, plus il sera utile à la direction.\n\nLes rapports sont notamment utilisés par la direction afin d’assurer le suivi des membres de la sécurité et peuvent être pris en compte dans le cadre de promotions ou de mesures administratives.',
	},
];

const createReportPanel = () => new Prompt({
	title: 'Rapports de sécurité',
	description: 'En réagissant au bouton ci-dessous, vous lancerez une procédure permettant de créer un rapport.',
	color: 0x5865f2,
	fields: REPORT_PANEL_FIELDS,
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
		.setDescription('Envoie le panel de création des rapports.'),
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
