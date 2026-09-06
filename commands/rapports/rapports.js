const { SlashCommandBuilder, MessageFlags, EmbedBuilder, time, TimestampStyles } = require('discord.js');
const Form = require('../../framework_utils/Form.js');
const { rapportForumChannelId } = require('../../config.json');

const getUserThread = async (forumChannel, username) => {
	const cacheThreads = forumChannel?.threads?.cache ?? [];
	const cachedThread = cacheThreads.find((thread) => thread?.name?.toLowerCase() === username.toLowerCase());
	if (cachedThread) return cachedThread;

	const fetchedThreads = await forumChannel.threads.fetch();
	const threadCollection = fetchedThreads?.threads ?? fetchedThreads ?? [];
	return threadCollection.find((thread) => thread?.name?.toLowerCase() === username.toLowerCase()) ?? null;
};

const formatDiscordDate = (dateValue) => {
	if (!dateValue || typeof dateValue !== 'object') return 'Non renseignée';
	const { day, month, year, hour = 0, minute = 0 } = dateValue;
	if (day == null || month == null || year == null) return 'Non renseignée';
	const isoDate = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
	if (Number.isNaN(isoDate.getTime())) return 'Non renseignée';
	return time(isoDate, TimestampStyles.ShortDateTime);
};

const buildReportForm = (type) => {
	const baseTitle = type === 'incident' ? 'Rapport d\'incident' : 'Rapport de patrouille';
	const form = new Form({
		title: baseTitle,
		description: type === 'incident'
			? 'Renseignez les détails de l\'incident.'
			: 'Renseignez les détails de la patrouille.',
	});

	if (type === 'incident') {
		form
			.section('Informations générales', 'Données de base sur l\'incident.', (sectionForm) => {
				sectionForm.date('date', 'Date de l\'incident', { required: true });
				sectionForm.text('lieu', 'Lieu', { required: true });
				sectionForm.text('acteurs', 'Personnels impliqués', { required: false });
				sectionForm.text('quarantaines', 'Procédures de quarantaine', { required: false });
			})
			.section('Détails', 'Décrivez précisément ce qui s\'est produit.', (sectionForm) => {
				sectionForm.text('detail', 'Détail complet de l\'incident', { paragraph: true, required: true });
			});
	}
	else {
		form
			.section('Informations générales', 'Données de base sur la patrouille.', (sectionForm) => {
				sectionForm.date('date', 'Date de la patrouille', { required: true });
				sectionForm.text('zone', 'Zone ou secteur couvert', { required: true });
				sectionForm.text('agents', 'Agents mobilisés', { required: false });
			})
			.section('Détails', 'Décrivez la patrouille et ses observations.', (sectionForm) => {
				sectionForm.text('detail', 'Observations et incidents relevés', { paragraph: true, required: true });
			});
	}

	return form;
};

module.exports = {
	cooldown: 10,
	data: new SlashCommandBuilder()
		.setName('rapport')
		.setDescription('Crée un nouveau rapport'),
	async execute(interaction) {
		const forumChannelId = process.env.RAPPORT_FORUM_CHANNEL_ID || rapportForumChannelId;
		let forumChannel;
		try {
			forumChannel = await interaction.guild.channels.fetch(forumChannelId);
		}
		catch (error) {
			console.error('[RAPPORT] Impossible de récupérer le forum des rapports:', error);
			return interaction.reply({
				content: 'Le forum de rapports est indisponible.',
				flags: MessageFlags.Ephemeral,
			});
		}

		if (!forumChannel || !forumChannel.threads) {
			return interaction.reply({
				content: 'Le canal de rapport configuré est invalide.',
				flags: MessageFlags.Ephemeral,
			});
		}

		const typeForm = new Form({
			title: 'Création d’un rapport',
			description: 'Sélectionnez le type de rapport avant de remplir le formulaire.',
		})
			.section('Type de rapport', 'Choisissez le type de rapport concerné.', (form) => {
				form.choice('rapport_type', 'Type de rapport', [
					{ label: 'Rapport d\'incident', value: 'incident' },
					{ label: 'Rapport de patrouille', value: 'patrouille' },
				], { required: true });
			});

		await typeForm.send(interaction, {
			ephemeral: true,
			onConfirm: async (typeData, meta) => {
				const reportType = typeData.rapport_type;
				if (!reportType) {
					return interaction.followUp({
						content: 'Aucun type de rapport sélectionné.',
						flags: MessageFlags.Ephemeral,
					});
				}

				const detailedForm = buildReportForm(reportType);
				await detailedForm.send(interaction, {
					ephemeral: true,
					onConfirm: async (reportData, formMeta) => {
						const userThreadName = meta.username;
						let thread = await getUserThread(forumChannel, userThreadName);
						if (!thread) {
							thread = await forumChannel.threads.create({
								name: userThreadName,
								message: {
									embeds: [new EmbedBuilder()
										.setColor(0x5865f2)
										.setTitle(`Thread de ${userThreadName}`)
										.setDescription('Démarré automatiquement pour les rapports du joueur.')
										.setTimestamp()],
								},
							});
						}

						const reportTitle = reportType === 'incident' ? 'Rapport d\'incident' : 'Rapport de patrouille';
						const reportDate = formatDiscordDate(reportData.date);
						const embed = new EmbedBuilder()
							.setColor(0x5865f2)
							.setTitle(`📄 ${reportTitle}`)
							.setDescription(`Soumis par ${formMeta.username} (${formMeta.user_id})`)
							.addFields(
								{ name: 'Type', value: reportTitle, inline: true },
								{ name: 'Date', value: reportDate, inline: true },
								{ name: reportType === 'incident' ? 'Lieu' : 'Zone', value: String(reportData.lieu ?? reportData.zone ?? 'Non renseigné'), inline: true },
								{ name: '────────────────────', value: '\u200b', inline: false },
								{ name: reportType === 'incident' ? 'Personnels impliqués' : 'Agents mobilisés', value: String(reportData.acteurs ?? reportData.agents ?? 'Non renseigné') },
								{ name: reportType === 'incident' ? 'Quarantaine' : 'Observations', value: String(reportData.quarantaines ?? reportData.observations ?? 'Non renseigné') },
								{ name: 'Détails', value: String(reportData.detail ?? 'Non renseigné') },
							)
							.setTimestamp();

						await thread.send({ embeds: [embed] });

						await interaction.followUp({
							embeds: [new EmbedBuilder()
								.setColor(0x57f287)
								.setTitle('✅ Rapport envoyé')
								.setDescription(`Votre rapport a bien été envoyé dans le fil ${thread.toString()}.`)
								.setTimestamp()],
							flags: MessageFlags.Ephemeral,
						});
					},
				});
			},
		});
	},
};