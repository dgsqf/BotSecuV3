const {
	SlashCommandBuilder,
	MessageFlags,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	time,
	TimestampStyles,
} = require('discord.js');
const Form = require('../../framework_utils/Form.js');
const Personnel = require('../../framework_utils/Personnel.js');
const Permissions = require('../../framework_utils/Permissions.js');
const RapportNotation = require('../../framework_utils/RapportNotation.js');
const { rapportForumChannelId, rapportSuiviChannelId } = require('../../config.json');
const hasReportPermission = (interaction) => Permissions.hasPermission(interaction, 'rapports.creer');

// Rôle « Non recensé (membre de la sécurité) » : ses porteurs ne peuvent pas ouvrir de rapport,
// même s'ils ont le rôle Sécurité requis par rapports.creer.
const UNREGISTERED_ROLE_ID = '1553807221261996052';

// Permission rapports.creer + rôle non-recensé interdit : un membre non recensé ne peut pas ouvrir un rapport.
const canOpenReport = (interactionOrMember) =>
	hasReportPermission(interactionOrMember) && !Permissions.hasRole(interactionOrMember, UNREGISTERED_ROLE_ID);

const getUserThread = async (forumChannel, username) => {
	const cacheThreads = forumChannel?.threads?.cache ?? [];
	const cachedThread = cacheThreads.find((thread) => thread?.name?.toLowerCase() === username.toLowerCase());
	if (cachedThread) return cachedThread;

	const fetchedThreads = await forumChannel.threads.fetch();
	const threadCollection = fetchedThreads?.threads ?? fetchedThreads ?? [];
	return threadCollection.find((thread) => thread?.name?.toLowerCase() === username.toLowerCase()) ?? null;
};

// Le contenu de la section « Détails » des rapports n'est plus inclus dans l'embed : les valeurs des
// champs d'embed sont limitées à 1024 caractères par Discord (et 4000 pour les champs de formulaire),
// ce qui faisait planter l'envoi pour un rapport trop long. Le contenu détaillé est envoyé dans le corps
// du thread, en messages Markdown, découpés à 2000 caractères si nécessaire.
const MAX_FIELD_VALUE_LENGTH = 1024;
const DETAILS_BODY_HEADER = '## 🧾 Détails du rapport';
// 2000 caractères/message, marge incluse pour l'en-tête de reprise.
const DETAILS_PART_LIMIT = 1920;

// Découpe un texte en blocs de taille fixe en privilégiant les coupures à la ligne ; la
// concaténation des blocs restitue exactement le texte d'origine.
const splitDetailsBody = (text, limit = DETAILS_PART_LIMIT) => {
	if (text.length <= limit) return [text];
	const parts = [];
	let remaining = text;
	while (remaining.length > limit) {
		let cutIndex = remaining.lastIndexOf('\n', limit - 1);
		if (cutIndex <= 0 || cutIndex < limit / 2) cutIndex = limit - 1;
		parts.push(remaining.slice(0, cutIndex + 1));
		remaining = remaining.slice(cutIndex + 1);
	}
	if (remaining) parts.push(remaining);
	return parts;
};

// Transforme le contenu détaillé en liste de messages, chacun identifié par l'en-tête partagé
// (utilisé par /rapport-recapitulatif pour rattacher les détails au bon rapport).
const buildDetailMessages = (content) => {
	const trimmed = content?.trim();
	if (!trimmed) return [];
	const parts = splitDetailsBody(trimmed);
	const total = parts.length;
	return parts.map((part, index) => ({
		content: DETAILS_BODY_HEADER
			+ (index > 0 ? ` (suite ${index + 1}/${total})` : '')
			+ `\n\n${part}`,
	}));
};

// Sections de détails liées au type de rapport ; toutes lues par la commande /rapport-recapitulatif.
const buildDetailSections = (reportType, reportData) => {
	switch (reportType) {
	case 'incident':
		return [
			{ title: 'Personnel notable présent', value: String(reportData.personnel) },
			{ title: 'Détail complet de l\'incident', value: String(reportData.detail ?? 'Non renseigné') },
		];
	case 'prise-service':
		return [
			{ title: 'Incident éventuel', value: String(reportData.incident || 'Aucun') },
			{ title: 'Activités suspectes', value: String(reportData.activites_suspectes || 'Aucune') },
		];
	case 'experience':
		return [{ title: 'Observations', value: String(reportData.observations) }];
	case 'personnel':
		return [{ title: 'Détails de l\'incident', value: String(reportData.detail ?? 'Non renseigné') }];
	default:
		return [];
	}
};

const formatDiscordDate = (dateValue) => {
	if (!dateValue || typeof dateValue !== 'object') return 'Non renseignée';
	const { day, month, year, hour = 0, minute = 0 } = dateValue;
	if (day == null || month == null || year == null) return 'Non renseignée';
	const isoDate = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
	if (Number.isNaN(isoDate.getTime())) return 'Non renseignée';
	return time(isoDate, TimestampStyles.ShortDateTime);
};

const parseServiceDurationHours = (value) => {
	if (value == null || value === '') return null;
	if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
	if (typeof value !== 'string') return null;
	const normalized = value.trim().replace(/,/g, '.').toLowerCase();
	if (!normalized) return null;
	if (/^\d+(?:\.\d+)?$/.test(normalized)) return Number(normalized);

	const compactMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*(?:h|hr|heure|heures|hrs)\s*(\d{1,2})(?:\s*(?:m|min|minute|minutes))?$/);
	if (compactMatch) {
		const hours = Number(compactMatch[1]);
		const minutes = Number(compactMatch[2]);
		if (Number.isFinite(hours) && Number.isFinite(minutes) && minutes >= 0 && minutes < 60) return hours + (minutes / 60);
		return null;
	}

	const hourMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|heure|heures|hrs)/);
	const minuteMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:m|min|minute|minutes)/);
	const colonMatch = normalized.match(/^(\d+):(\d{1,2})$/);

	if (colonMatch) {
		const hours = Number(colonMatch[1]);
		const minutes = Number(colonMatch[2]);
		if (Number.isFinite(hours) && Number.isFinite(minutes) && minutes >= 0 && minutes < 60) return hours + (minutes / 60);
		return null;
	}

	const hours = hourMatch ? Number(hourMatch[1]) : 0;
	const minutes = minuteMatch ? Number(minuteMatch[1]) : 0;
	if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
	if (!hourMatch && !minuteMatch && !/\d/.test(normalized)) return null;
	const total = hours + (minutes / 60);
	return total > 0 ? total : null;
};

// Consigne de format affichée dans le libellé et le modal du champ « Durée » ; testée par parseServiceDurationHours.
const SERVICE_DURATION_FORMAT_HINT = 'Format : « 2 h 30 » (heures + minutes), « 90 min » ou « 2,5 » (heures décimales)'.slice(0, 100);

// Valide la durée saisie et renvoie le message d'erreur à afficher, ou null si le format est accepté.
const validateServiceDuration = (value) => {
	const text = String(value ?? '').trim();
	if (parseServiceDurationHours(text) == null) {
		return `La durée « ${text.slice(0, 50)} » n’a pas été reconnue. ${SERVICE_DURATION_FORMAT_HINT}.`;
	}
	return null;
};

// Le salon de suivi ne conserve qu'un rôle de notification : la lecture et la notation des seuls
// rapports d'incident et d'expérience (0 à 2 points + avis) se font désormais directement dans
// le forum des rapports, via le bouton « Noter le rapport » attaché au message du rapport
// (voir framework_utils/RapportNotation.js).
const publishReportTracking = async (interaction, guild, reportTitle, formMeta, thread) => {
	if (!rapportSuiviChannelId) return;
	const trackingChannel = await guild.channels.fetch(rapportSuiviChannelId).catch((error) => {
		interaction.client.log('RAPPORT', 'ERROR', `Impossible de récupérer le salon de suivi des rapports: ${error.stack || error}`);
		return null;
	});
	if (!trackingChannel?.isTextBased()) return;
	await trackingChannel.send({
		embeds: [new EmbedBuilder()
			.setColor(0x5865f2)
			.setTitle('Nouveau rapport')
			.addFields(
				{ name: 'Type', value: reportTitle, inline: true },
				{ name: 'Auteur', value: `${formMeta.username} (<@${formMeta.user_id}>)`, inline: true },
				{ name: 'Rapport', value: `[Ouvrir le rapport](${thread.url})`, inline: true },
			)
			.setTimestamp()],
	});
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
				sectionForm.text('duree', 'Durée de la prise de service', {
					required: true,
					placeholder: 'Exemple : 2 h 30',
					modalDescription: SERVICE_DURATION_FORMAT_HINT,
					validate: validateServiceDuration,
				});
				sectionForm.text('activites_suspectes', 'Activités suspectes', { paragraph: true, required: false });
			});
	}
	else if (type === 'experience') {
		form
			.section('Informations générales', 'Information sur l’expérience.', (sectionForm) => {
				sectionForm.text('anomalie', 'Anomalie', { required: true });
				sectionForm.date('date', 'Date de l\'expérience', { required: true });
				sectionForm.number('nombre_classe_d', 'Nombre de classe-D', { required: true });
			})
			.section('Détails', 'Décrivez l’expérience et ses observations.', (sectionForm) => {
				sectionForm.text('personnel_scientifique', 'Membre du personnel scientifique présent', { required: true });
				sectionForm.text('personnel_securite', 'Membre du personnel de sécurité présent', { required: true });
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

	if (!canOpenReport({ member })) {
		const isUnregistered = Permissions.hasRole({ member }, UNREGISTERED_ROLE_ID);
		const denied_access_embed = new EmbedBuilder()
			.setColor(0xFF0000)
			.setTitle('Accès refusé')
			.setDescription(isUnregistered
				? 'Les membres non recensés ne peuvent pas rédiger de rapport. Faites-vous enregistrer auprès du département de la sécurité.'
				: 'Vous ne possédez pas la permission rapports.creer.');
		return interaction.reply({
			embeds: [denied_access_embed],
			flags: MessageFlags.Ephemeral,
		});
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
		});		await typeForm.send(interaction, {
		ephemeral: true,
		canSubmit: canOpenReport,
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
				canSubmit: canOpenReport,
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
					let serviceHours = null;
					// Durée obligatoire : si elle est illisible, on refuse l'envoi avec un message explicite au lieu d'enregistrer un rapport inutilisable.
					if (reportType === 'prise-service') {
						serviceHours = parseServiceDurationHours(reportData.duree);
						if (serviceHours == null) {
							await interaction.followUp({
								embeds: [new EmbedBuilder()
									.setColor(0xed4245)
									.setTitle('Durée non reconnue')
									.setDescription(`La durée « ${String(reportData.duree).trim()} » n’a pas été reconnue. ${SERVICE_DURATION_FORMAT_HINT}.`)],
								flags: MessageFlags.Ephemeral,
							});
							await interaction.client.log('RAPPORT', 'WARN', `Rapport de prise de service refusé : durée illisible (${formMeta.username} <@${formMeta.user_id}>).`);
							return;
						}
					}

					// Sections « Détails » du formulaire : envoyées dans le corps du thread, pas dans l'embed.
					const detailSections = buildDetailSections(reportType, reportData);
					const embedFields = [
						{ name: 'Type', value: reportTitle, inline: true },
						...(reportType !== 'personnel' ? [{ name: 'Date', value: reportDate, inline: true }] : []),
						...(reportType === 'incident' ? [{ name: 'Lieu', value: String(reportData.lieu), inline: true }] : []),
						...(reportType === 'personnel' ? [{ name: 'Agent concerné', value: `<@${reportData.agent}>`, inline: true }] : []),
						...(reportType === 'prise-service' ? [{ name: 'Personnel présent', value: String(reportData.personnel) }] : []),
						...(reportType === 'prise-service' ? [{ name: 'Durée de la prise de service', value: String(reportData.duree) }] : []),
						...(reportType === 'experience' ? [
							{ name: 'Anomalie', value: String(reportData.anomalie) },
							{ name: 'Personnel scientifique présent', value: String(reportData.personnel_scientifique) },
							{ name: 'Nombre de Classe-D', value: String(reportData.nombre_classe_d) },
							{ name: 'Personnel de sécurité présent', value: String(reportData.personnel_securite) },
						] : []),
						...(reportType === 'personnel' ? [{ name: 'Article du règlement enfreint', value: String(reportData.article) }] : []),
					];
					// Garde-fou : un champ restant trop long pour un embed part lui aussi au corps du message.
					const generalFields = [];
					for (const field of embedFields) {
						if (field.value.length > MAX_FIELD_VALUE_LENGTH) detailSections.push({ title: field.name, value: field.value });
						else generalFields.push(field);
					}
					const embed = new EmbedBuilder()
						.setColor(0x5865f2)
						.setTitle(`📄 ${reportTitle}`)
						.setDescription(`Soumis par ${formMeta.username} (${formMeta.user_id})`)
						.addFields(...generalFields)
						.setTimestamp();

					const detailsContent = detailSections.map((section) => `### ${section.title}\n${section.value}`).join('\n\n');
					// Bouton de notation persistant : il est traité par un gestionnaire global, pas par un
					// collector périssable, donc il ne fonctionne toujours après un redémarrage du bot.
					// Seuls les rapports d'incident et d'expérience sont notés : la prise de service ne
					// rapporte que ses heures (créditées ci-dessous) et le rapport personnel rien.
					const ratingButton = new ButtonBuilder()
						.setCustomId(RapportNotation.BUTTON_CUSTOM_ID)
						.setLabel('Noter le rapport')
						.setStyle(ButtonStyle.Primary);
					const ratingComponents = RapportNotation.isRatableReportType(reportType)
						? [new ActionRowBuilder().addComponents(ratingButton)]
						: [];
					await thread.send({
						embeds: [embed],
						...(ratingComponents.length ? { components: ratingComponents } : {}),
					});
					for (const detailMessage of buildDetailMessages(detailsContent)) {
						await thread.send({ content: detailMessage.content });
					}
					try {
						if (reportType === 'prise-service' && serviceHours != null) {
							await Personnel.addActivityHours(interaction.client, formMeta.user_id, serviceHours, {
								source: 'rapport',
								reason: `Rapport de prise de service (${String(reportData.duree).trim()})`,
								actorId: formMeta.user_id,
							});
						}
					}
					catch (error) {
						await interaction.client.log('RAPPORT', 'ERROR', `Le rapport a été envoyé, mais ses heures d’activité n’ont pas été ajoutées: ${error.stack || error}`);
					}
					await publishReportTracking(interaction, reportGuild, reportTitle, formMeta, thread);
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
	canExecute: canOpenReport,
	execute: startReport,
	startReport,
	parseServiceDurationHours,
	validateServiceDuration,
	splitDetailsBody,
	buildDetailMessages,
	buildDetailSections,
	DETAILS_BODY_HEADER,
};