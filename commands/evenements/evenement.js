const {
	ButtonStyle,
	EmbedBuilder,
	MessageFlags,
	SlashCommandBuilder,
} = require('discord.js');
const Prompt = require('../../framework_utils/Prompt.js');
const Events = require('../../framework_utils/Events.js');
const config = require('../../config.json');

const EVENT_PANEL_FIELDS = [
	{
		name: 'Présentation',
		value: 'Il existe actuellement quatre types d’événements pouvant être créés et concernant la sécurité.\n\n╾─ Le premier type d’événement est une expérience. Il s’agit du cas le plus courant. Cette fonctionnalité doit être utilisée par les scientifiques afin de prévoir une expérience et d’avertir la sécurité à l’avance de la date et du lieu de rendez-vous. La sécurité peut ainsi prendre connaissance de l’expérience prévue et s’organiser en conséquence.\n\nÀ noter que la création d’un événement ne garantit pas nécessairement la présence d’effectifs de sécurité. Leur présence peut notamment dépendre de l’heure, des circonstances et des effectifs disponibles au moment de l’expérience.',
	},
	{
		name: 'Demandes d’escorte',
		value: '╾─ Le deuxième type d’événement est une demande d’escorte. Cette fonctionnalité est réservée au personnel jugé important de la Fondation SCP. Elle permet à ce dernier de demander à l’avance la présence d’une UPR, ou Unité de Protection Rapprochée, afin d’assurer sa protection.\n\nComme pour une expérience, le demandeur doit préciser un lieu ainsi qu’une date et une heure de rendez-vous afin de permettre aux UPR de s’organiser.\n\nÀ noter que les UPR sont présents de manière générale sur l’installation. Il n’est donc pas nécessaire de créer une demande d’escorte pour chaque déplacement.\n\nCette fonctionnalité est réservée au personnel particulièrement important ou exceptionnel dont la présence sur site est occasionnelle et nécessite une protection spécifique.',
	},
	{
		name: 'Sélections et entraînements',
		value: '╾─ Les troisième et quatrième types d’événements sont réservés à la sécurité. Il s’agit des sélections et des entraînements. Ces événements permettent notamment d’annoncer et d’organiser les différentes activités liées à la formation et à l’organisation des membres de la sécurité. Ils sont également annoncés via les salons prévus à cet effet.',
	},
	{
		name: 'Consignes',
		value: '∴ L’utilisation du système doit rester justifiée et cohérente avec son objectif. Tout abus du système, notamment la création répétée d’événements injustifiés ou ne correspondant pas à leur fonction, pourra entraîner des sanctions.',
	},
];

const createEventPanel = () => new Prompt({
	title: 'Évènements',
	description: 'Créez un évènement en choisissant un type auquel vous avez accès.',
	color: 0x3498db,
	fields: EVENT_PANEL_FIELDS,
	metadata: { type: 'event-panel' },
	buttons: [{
		customId: 'event:open',
		label: 'Créer un évènement',
		style: ButtonStyle.Primary,
		callback: openEventSelector,
	}],
});

const openEventSelector = async (interaction) => {
	const entries = Events.getAvailableTypes(interaction);
	if (!entries.length) return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('Accès refusé').setDescription('Aucun type d’évènement ne vous est accessible.')], flags: MessageFlags.Ephemeral });
	await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x3498db).setTitle('Type d’évènement').setDescription('Sélectionnez le type à créer.')], components: [Events.buildTypeSelector(entries)], flags: MessageFlags.Ephemeral });
	const reply = await interaction.fetchReply();
	const collector = reply.createMessageComponentCollector({ time: 15 * 60_000, filter: (component) => component.user.id === interaction.user.id });
	collector.on('collect', async (component) => {
		if (component.customId !== 'event:type') return;
		collector.stop('selected');
		const typeId = component.values[0];
		const type = Events.getType(typeId);
		if (!type || !Events.getAvailableTypes(interaction).some(([id]) => id === typeId)) return component.update({ content: 'Accès refusé.', embeds: [], components: [] });
		await component.update({ content: `Type sélectionné : **${type.label}**`, embeds: [], components: [] });
		const form = Events.buildForm(typeId);
		await form.send(interaction, {
			ephemeral: true,
			onConfirm: async (values, meta) => {
				try {
					await Events.publishEvent(interaction, typeId, values, meta);
					await interaction.followUp({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('Évènement créé').setDescription('L’évènement a été publié dans le forum dédié.')], flags: MessageFlags.Ephemeral });
				}
				catch (error) {
					await interaction.followUp({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('Création impossible').setDescription(error.message)], flags: MessageFlags.Ephemeral });
					await interaction.client.log('EVENT', 'ERROR', `Erreur de publication: ${error.stack || error}`);
				}
			},
		});
	});
};

module.exports = {
	data: new SlashCommandBuilder().setName('evenement').setDescription('Crée un évènement de sécurité.'),
	async execute(interaction) {
		await openEventSelector(interaction);
	},
	async sendPanel(interaction) {
		const channel = await interaction.client.channels.fetch(config.eventPanelChannelId);
		await createEventPanel().send(channel);
		await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('Panel envoyé')], flags: MessageFlags.Ephemeral });
	},
	async createPanel(channel) {
		return createEventPanel().send(channel);
	},
	async attachPanel(message) {
		return createEventPanel().attach(message);
	},
	async restore(client) {
		if (!config.eventPanelChannelId) return;
		for (const guild of client.guilds.cache.values()) {
			const channel = await guild.channels.fetch(config.eventPanelChannelId).catch(() => null);
			if (!channel?.isTextBased()) continue;
			const messages = await channel.messages.fetch({ limit: 100 });
			for (const message of messages.values()) if (Prompt.readMetadata(message)?.type === 'event-panel') await createEventPanel().attach(message);
		}
	},
};