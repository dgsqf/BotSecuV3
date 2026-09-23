const {
	ButtonStyle,
	EmbedBuilder,
	MessageFlags,
	SlashCommandBuilder,
} = require('discord.js');
const Prompt = require('../../framework_utils/Prompt.js');
const Events = require('../../framework_utils/Events.js');
const config = require('../../config.json');

const createEventPanel = () => new Prompt({
	title: 'Évènements',
	description: 'Créez un évènement en choisissant un type auquel vous avez accès.',
	color: 0x3498db,
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