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
	const titles = {
		incident: 'Rapport d\'incident',
		patrouille: 'Rapport de patrouille',
		personnel: 'Rapport concernant le personnel',
	};
	const baseTitle = titles[type];
	const form = new Form({
		title: baseTitle,
		description: `Renseignez les détails du ${type === 'incident' ? 'incident' : type === 'patrouille' ? 'rapport de patrouille' : 'rapport concernant le personnel'}.`,
	});

	if (type === 'incident') {
		form
			.section('Informations générales', 'Données de base sur l\'incident.', (sectionForm) => {
				sectionForm.date('date', 'Date de l\'incident', { required: true });
				sectionForm.text('lieu', 'Lieu', { required: true });
			})
			.section('Détails', 'Décrivez précisément ce qui s\'est produit.', (sectionForm) => {
				sectionForm.text('personnel', 'Personnel notable présent lors de l\'incident', { paragraph: true, required: true });
				sectionForm.text('detail', 'Détail complet de l\'incident', { paragraph: true, required: true });
			});
	}
	else if (type === 'patrouille') {
		form
			.section('Informations générales', 'Données de base sur la patrouille.', (sectionForm) => {
				sectionForm.date('date', 'Date de la patrouille', { required: true });
				sectionForm.text('zone', 'Zone de patrouille', { paragraph: true, required: true });
				sectionForm.text('personnel', 'Personnel présent lors de la patrouille', { paragraph: true, required: true });
			})
			.section('Détails', 'Décrivez la patrouille et ses observations.', (sectionForm) => {
				sectionForm.text('incident', 'Incident éventuel', { paragraph: true, required: false });
				sectionForm.text('duree', 'Durée de la patrouille', { required: true });
				sectionForm.text('activites_suspectes', 'Activités suspectes', { paragraph: true, required: false });
			});
	}
	else {
		form.section('Informations sur le personnel', 'Renseignez les informations concernant l\'agent.', (sectionForm) => {
			sectionForm.user('agent', 'Agent concerné', { required: true });
			sectionForm.text('article', 'Article du règlement enfreint', { paragraph: true, required: true });
			sectionForm.text('detail', 'Détails de l\'incident', { paragraph: true, required: true });
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
		const REQUIRED_ROLE_ID = '1545770783387684924';

		// Step 1: Check if the user (interaction.member) has the required role
		if (!interaction.member.roles.cache.has(REQUIRED_ROLE_ID)) {
			denied_access_embed = new EmbedBuilder()
				.setColor(0xFF0000)
				.setTitle('Accès refusé')
				.setDescription('Vous devez posséder le rôle Sécurité pour utiliser cette commande.');
			// Authorization Failure
			await interaction.reply({
				embeds: [denied_access_embed],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const forumChannelId = process.env.RAPPORT_FORUM_CHANNEL_ID || rapportForumChannelId;
		let forumChannel;
		try {
			forumChannel = await interaction.guild.channels.fetch(forumChannelId);
		}
		catch (error) {
			console.error('[RAPPORT] Impossible de récupérer le forum des rapports:', error);
			return interaction.reply({
				embeds: [new EmbedBuilder()
					.setColor(0xed4245)
					.setTitle('Forum indisponible')
					.setDescription('Le forum de rapports est indisponible.')],
				flags: MessageFlags.Ephemeral,
			});
		}

		if (!forumChannel || !forumChannel.threads) {
			return interaction.reply({
				embeds: [new EmbedBuilder()
					.setColor(0xed4245)
					.setTitle('Canal invalide')
					.setDescription('Le canal de rapport configuré est invalide.')],
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
					{ label: 'Rapport concernant le personnel', value: 'personnel' },
				], { required: true });
			});

		await typeForm.send(interaction, {
			ephemeral: true,
			onConfirm: async (typeData, meta) => {
				const reportType = typeData.rapport_type;
				if (!reportType) {
					return interaction.followUp({
						embeds: [new EmbedBuilder()
							.setColor(0xfee75c)
							.setTitle('Type de rapport manquant')
							.setDescription('Aucun type de rapport n’a été sélectionné.')],
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

						const reportTitle = reportType === 'incident'
							? 'Rapport d\'incident'
							: reportType === 'patrouille' ? 'Rapport de patrouille' : 'Rapport concernant le personnel';
						const reportDate = formatDiscordDate(reportData.date);
						const embed = new EmbedBuilder()
							.setColor(0x5865f2)
							.setTitle(`📄 ${reportTitle}`)
							.setDescription(`Soumis par ${formMeta.username} (${formMeta.user_id})`)
							.addFields(
								{ name: 'Type', value: reportTitle, inline: true },
								...(reportType !== 'personnel' ? [{ name: 'Date', value: reportDate, inline: true }] : []),
								...(reportType === 'incident' ? [{ name: 'Lieu', value: String(reportData.lieu), inline: true }] : []),
								...(reportType === 'patrouille' ? [{ name: 'Zone de patrouille', value: String(reportData.zone), inline: true }] : []),
								...(reportType === 'personnel' ? [{ name: 'Agent concerné', value: `<@${reportData.agent}>`, inline: true }] : []),
								{ name: '────────────────────', value: '\u200b', inline: false },
								...(reportType === 'incident' ? [{ name: 'Personnel notable présent', value: String(reportData.personnel) }] : []),
								...(reportType === 'patrouille' ? [
									{ name: 'Personnel présent', value: String(reportData.personnel) },
									{ name: 'Incident éventuel', value: String(reportData.incident || 'Aucun') },
									{ name: 'Durée de la patrouille', value: String(reportData.duree) },
									{ name: 'Activités suspectes', value: String(reportData.activites_suspectes || 'Aucune') },
								] : []),
								...(reportType === 'personnel' ? [{ name: 'Article du règlement enfreint', value: String(reportData.article) }] : []),
								{ name: 'Détails de l\'incident', value: String(reportData.detail ?? 'Non renseigné') },
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