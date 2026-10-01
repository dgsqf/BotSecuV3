const {
	SlashCommandBuilder,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	MessageFlags,
} = require('discord.js');
const Personnel = require('../../framework_utils/Personnel.js');
const {
	requirePermission,
	reply,
	replyError,
	replyServiceError,
	formatDuration,
	runPersonnelForm,
} = require('../../framework_utils/PersonnelDiscord.js');

const TYPES = [
	{ name: 'Points', value: 'points' },
	{ name: 'Heures', value: 'hours' },
];
const PERIODS = [
	{ name: 'Depuis le début', value: 'all' },
	{ name: '7 derniers jours', value: 'week' },
	{ name: '30 derniers jours', value: 'month' },
];

const data = new SlashCommandBuilder()
	.setName('activite')
	.setDescription('Consulte et corrige l’activité du personnel.')
	.addSubcommand((subcommand) => subcommand.setName('points-ajouter').setDescription('Ajoute des points d’activité.'))
	.addSubcommand((subcommand) => subcommand.setName('points-retirer').setDescription('Retire des points pour corriger l’activité.'))
	.addSubcommand((subcommand) => subcommand.setName('heures-ajouter').setDescription('Ajoute des heures d’activité.'))
	.addSubcommand((subcommand) => subcommand.setName('heures-retirer').setDescription('Retire des heures pour corriger l’activité.'))
	.addSubcommand((subcommand) => subcommand.setName('voir').setDescription('Affiche l’activité d’un membre.'))
	.addSubcommand((subcommand) => subcommand.setName('top').setDescription('Affiche le classement d’activité.'));

const buildLeaderboardEmbed = (result, type, period) => {
	const labels = { all: 'Depuis le début', week: '7 derniers jours', month: '30 derniers jours' };
	const lines = result.rows.map((row, index) => {
		const position = (result.page - 1) * result.limit + index + 1;
		const amount = type === 'points' ? `${row.amount} points` : `${row.amount.toFixed(2)} h`;
		return `**${position}.** <@${row.discordId}> — ${amount}`;
	});
	return new EmbedBuilder()
		.setColor(0x5865f2)
		.setTitle(`Classement ${type === 'points' ? 'des points' : 'des heures'}`)
		.setDescription(lines.join('\n') || 'Aucun membre actif à afficher.')
		.setFooter({ text: `${labels[period]} · Page ${result.page}/${result.totalPages}` });
};

const sendLeaderboard = async (interaction, type, period) => {
	let page = 1;
	const firstPage = await Personnel.getLeaderboard({ type, period, page, limit: 10 });
	const message = await interaction.reply({
		embeds: [buildLeaderboardEmbed(firstPage, type, period)],
		components: [new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId('activity:previous').setLabel('Précédent').setStyle(ButtonStyle.Secondary).setDisabled(true),
			new ButtonBuilder().setCustomId('activity:next').setLabel('Suivant').setStyle(ButtonStyle.Secondary).setDisabled(firstPage.totalPages <= 1),
		)],
		flags: MessageFlags.Ephemeral,
		fetchReply: true,
	});
	const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: 120_000 });
	collector.on('collect', async (buttonInteraction) => {
		if (buttonInteraction.user.id !== interaction.user.id) {
			await buttonInteraction.reply({ content: 'Ce classement appartient à un autre utilisateur.', flags: MessageFlags.Ephemeral });
			return;
		}
		const nextPage = page + (buttonInteraction.customId === 'activity:next' ? 1 : -1);
		const result = await Personnel.getLeaderboard({ type, period, page: nextPage, limit: 10 });
		if (!result.rows.length && nextPage > 1) {
			await buttonInteraction.deferUpdate();
			return;
		}
		page = nextPage;
		await buttonInteraction.update({
			embeds: [buildLeaderboardEmbed(result, type, period)],
			components: [new ActionRowBuilder().addComponents(
				new ButtonBuilder().setCustomId('activity:previous').setLabel('Précédent').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
				new ButtonBuilder().setCustomId('activity:next').setLabel('Suivant').setStyle(ButtonStyle.Secondary).setDisabled(page >= result.totalPages),
			)],
		});
	});
	collector.on('end', () => message.edit({ components: [] }).catch(() => null));
};

module.exports = {
	cooldown: 3,
	data,
	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand();
		const isManual = subcommand.endsWith('-ajouter') || subcommand.endsWith('-retirer');
		if (isManual && !await requirePermission(interaction, 'staff')) return;
		try {
			if (isManual) {
				return runPersonnelForm({
					interaction,
					title: 'Mettre à jour l’activité',
					description: 'Renseignez le membre, le montant et la raison avant confirmation.',
					fields: [
						{ type: 'user', id: 'utilisateur', label: 'Membre concerné', required: true },
						{ type: 'number', id: 'montant', label: 'Montant', required: true, min: 0.01 },
						{ type: 'text', id: 'raison', label: 'Raison', required: true },
					],
					onConfirm: async (values) => {
						const user = values.utilisateur;
						const isHours = subcommand.startsWith('heures-');
						const isRemoval = subcommand.endsWith('-retirer');
						const amount = isRemoval ? -Number(values.montant) : Number(values.montant);
						const metadata = { source: 'commande manuelle', reason: String(values.raison).slice(0, 500), actorId: interaction.user.id };
						const result = isRemoval
							? await Personnel.removeActivity(interaction.client, user, { type: isHours ? 'hours' : 'points', amount, ...metadata })
							: await (isHours ? Personnel.addActivityHours(interaction.client, user, amount, metadata) : Personnel.addActivityPoints(interaction.client, user, amount, metadata));
						if (!result.ok) return replyError(interaction, 'Aucun profil n’existe pour ce membre.');
						const displayedAmount = isHours ? `${Math.abs(result.amount) / 60} h` : `${Math.abs(result.amount)} points`;
						return reply(interaction, new EmbedBuilder().setColor(0x57f287).setTitle('Activité mise à jour').setDescription(`${displayedAmount} ${isRemoval ? 'retiré(s) à' : 'ajouté(s) à'} <@${user}>.`));
					},
				});
			}
			if (subcommand === 'voir') {
				return runPersonnelForm({
					interaction,
					title: 'Voir l’activité',
					description: 'Choisissez le membre dont vous voulez consulter l’activité.',
					fields: [{ type: 'user', id: 'utilisateur', label: 'Membre concerné', required: false }],
					onConfirm: async (values) => {
						const target = values.utilisateur || interaction.user.id;
						const profile = await Personnel.getProfile(target);
						if (!profile) return replyError(interaction, 'Aucun profil n’existe pour ce membre.');
						return reply(interaction, new EmbedBuilder().setColor(0x5865f2).setTitle(`Activité de ${profile.firstName} ${profile.lastName}`).setDescription(`<@${target}>\n**Points :** ${profile.activityPoints}\n**Heures :** ${formatDuration(profile.activityMinutes)}`));
					},
				});
			}
			if (subcommand === 'top') {
				return runPersonnelForm({
					interaction,
					title: 'Classement d’activité',
					description: 'Sélectionnez le type et la période du classement.',
					fields: [
						{ type: 'choice', id: 'type', label: 'Type d’activité', required: true, choices: TYPES.map(({ name, value }) => ({ label: name, value })) },
						{ type: 'choice', id: 'periode', label: 'Période', required: true, choices: PERIODS.map(({ name, value }) => ({ label: name, value })) },
					],
					onConfirm: async (values) => sendLeaderboard(interaction, values.type, values.periode),
				});
			}
			return replyError(interaction, 'Sous-commande non prise en charge.');
		}
		catch (error) {
			return replyServiceError(interaction, error);
		}
	},
};