const { SlashCommandBuilder, MessageFlags, EmbedBuilder, time, TimestampStyles } = require('discord.js');
const Form = require('../../framework_utils/Form.js');
const {
	rapportForumChannelId,
	rapportSuiviChannelId,
	rapportLuEmoji = '👀',
	rapportPromotionEmoji = '✅',
} = require('../../config.json');
const REQUIRED_ROLE_ID = '1545770783387684924';

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

const publishReportTracking = async (interaction, guild, reportType, reportTitle, formMeta, thread, reportMessage) => {
	if (!rapportSuiviChannelId) return;
	const trackingChannel = await guild.channels.fetch(rapportSuiviChannelId).catch((error) => {
		interaction.client.log('RAPPORT', 'ERROR', `Impossible de récupérer le salon de suivi des rapports: ${error.stack || error}`);
		return null;
	});
	if (!trackingChannel?.isTextBased()) return;
	const notification = await trackingChannel.send({
		embeds: [new EmbedBuilder()
			.setColor(0x5865f2)
			.setTitle('Nouveau rapport')
			.addFields(
				{ name: 'Type', value: reportTitle, inline: true },
				{ name: 'Auteur', value: `${formMeta.username} (<@${formMeta.user_id}>)`, inline: true },
				{ name: 'Rapport', value: `[Ouvrir le rapport](${thread.url})`, inline: true },
				{ name: 'Utilisation des réactions', value: `${rapportLuEmoji} marque le rapport comme lu.\n${rapportPromotionEmoji} indique qu’il a été pris en compte pour une promotion et supprime cette notification.` },
			)
			.setFooter({ text: `rapport:${thread.id}:${reportMessage.id}:${reportType}` })
			.setTimestamp()],
	});
	await Promise.all([
		notification.react(rapportLuEmoji),
		notification.react(rapportPromotionEmoji),
	]);
};

const buildReportForm = (type) => {
	const titles = {
		incident: 'Rapport d\'incident',
		'prise-service': 'Rapport de prise de service',
		personnel: 'Rapport concernant le personnel',
		experience: 'Rapport d\'expérience',
	};
	const baseTitle = titles[type];
	const form = new Form({
		title: baseTitle,
		description: `Renseignez les détails du ${type === 'incident' ? 'incident' : type === 'prise-service' ? 'rapport de prise de service' : type === 'experience' ? 'rapport d\'expérience' : 'rapport concernant le personnel'}.`,
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
	else if (type === 'prise-service') {
		form
			.section('Informations générales', 'Données de base sur la prise de service.', (sectionForm) => {
				sectionForm.date('date', 'Date de la prise de service', { required: true });
				sectionForm.text('personnel', 'Personnel présent lors de la prise de service', { paragraph: true, required: true });
			})
			.section('Détails', 'Décrivez la prise de service et ses observations.', (sectionForm) => {
				sectionForm.text('incident', 'Incident éventuel', { paragraph: true, required: false });
				sectionForm.text('duree', 'Durée de la prise de service', { required: true });
				sectionForm.text('activites_suspectes', 'Activités suspectes', { paragraph: true, required: false });
			});
	}
	else if (type === 'experience') {
		form
			.section('Informations générales', 'Information sur l’expérience.', (sectionForm) => {
				sectionForm.text('anomalie', 'Anomalie', { required: true });
				sectionForm.text('personnel_scientifique', 'Membre du personnel scientifique présent', { required: true });
				sectionForm.number('nombre_classe_d', 'Nombre de classe-D', { required: true });
				sectionForm.text('personnel_securite', 'Membre du personnel de sécurité présent', { required: true });
				sectionForm.date('date', 'Date de l\'expérience', { required: true });
				sectionForm.text('observations', 'Observations', { paragraph: true, required: true });
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

const startReport = async (interaction, reportGuild = interaction.guild) => {
	const member = interaction.member || await reportGuild?.members.fetch(interaction.user.id).catch(() => null);

	// Step 1: Check if the user (interaction.member) has the required role
	if (!member?.roles.cache.has(REQUIRED_ROLE_ID)) {
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
		forumChannel = await reportGuild.channels.fetch(forumChannelId);
	}
	catch (error) {
		await interaction.client.log('RAPPORT', 'ERROR', `Impossible de récupérer le forum des rapports: ${error.stack || error}`);
		return interaction.reply({
			embeds: [new EmbedBuilder()
				.setColor(0xed4245)
				.setTitle('Forum indisponible')
				.setDescription('Le forum de rapports est indisponible. Vous pouvez ouvrir un ticket afin que notre équipe puisse corriger ce problème.')],
			flags: MessageFlags.Ephemeral,
		});
	}

	if (!forumChannel || !forumChannel.threads) {
		return interaction.reply({
			embeds: [new EmbedBuilder()
				.setColor(0xed4245)
				.setTitle('Canal invalide')
				.setDescription('Le canal de rapport configuré est invalide. Vous pouvez ouvrir un ticket afin que notre équipe puisse corriger ce problème.')],
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
				{ label: 'Rapport de prise de service', value: 'prise-service' },
				{ label: 'Rapport concernant le personnel', value: 'personnel' },
				{ label: 'Rapport d\'expérience', value: 'experience' },
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
						: reportType === 'prise-service' ? 'Rapport de prise de service' : reportType === 'experience' ? 'Rapport d\'expérience' : 'Rapport concernant le personnel';
					const reportDate = formatDiscordDate(reportData.date);
					const embed = new EmbedBuilder()
						.setColor(0x5865f2)
						.setTitle(`📄 ${reportTitle}`)
						.setDescription(`Soumis par ${formMeta.username} (${formMeta.user_id})`)
						.addFields(
							{ name: 'Type', value: reportTitle, inline: true },
							...(reportType !== 'personnel' ? [{ name: 'Date', value: reportDate, inline: true }] : []),
							...(reportType === 'incident' ? [{ name: 'Lieu', value: String(reportData.lieu), inline: true }] : []),
							...(reportType === 'personnel' ? [{ name: 'Agent concerné', value: `<@${reportData.agent}>`, inline: true }] : []),
							{ name: '────────────────────', value: '\u200b', inline: false },
							...(reportType === 'incident' ? [{ name: 'Personnel notable présent', value: String(reportData.personnel) }] : []),
							...(reportType === 'prise-service' ? [
								{ name: 'Personnel présent', value: String(reportData.personnel) },
								{ name: 'Incident éventuel', value: String(reportData.incident || 'Aucun') },
								{ name: 'Durée de la prise de service', value: String(reportData.duree) },
								{ name: 'Activités suspectes', value: String(reportData.activites_suspectes || 'Aucune') },
							] : []),
							...(reportType === 'experience' ? [
								{ name: 'Anomalie', value: String(reportData.anomalie) },
								{ name: 'Personnel scientifique présent', value: String(reportData.personnel_scientifique) },
								{ name: 'Nombre de Classe-D', value: String(reportData.nombre_classe_d) },
								{ name: 'Personnel de sécurité présent', value: String(reportData.personnel_securite) },
								{ name: 'Observations', value: String(reportData.observations) },
							] : []),
							...(reportType === 'personnel' ? [{ name: 'Article du règlement enfreint', value: String(reportData.article) }] : []),
							...(reportType === 'incident' || reportType === 'personnel'
								? [{ name: 'Détails', value: String(reportData.detail ?? 'Non renseigné') }]
								: []),
						)
						.setFooter({ text: `Réactions du suivi : ${rapportLuEmoji} marque le rapport comme lu ; ${rapportPromotionEmoji} indique une prise en compte pour promotion et supprime la notification.` })
						.setTimestamp();

					const reportMessage = await thread.send({ embeds: [embed] });
					await publishReportTracking(interaction, reportGuild, reportType, reportTitle, formMeta, thread, reportMessage);
					await interaction.client.log('RAPPORT', 'INFO', `Rapport de type "${reportType}" soumis par ${formMeta.username} <@${formMeta.user_id}> dans le thread ${thread.name} <#${thread.id}>.`);
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
};

module.exports = {
	cooldown: 10,
	data: new SlashCommandBuilder()
		.setName('rapport')
		.setDescription('Crée un nouveau rapport'),
	execute: startReport,
	startReport,
};