/*
 * Notation des rapports :
 * - le message d'un rapport dans le forum porte un bouton « Noter le rapport » persistant ;
 * - seuls les rapports d'incident et d'expérience sont notés ; un officier (permission
 *   rapports.suivi) ouvre le formulaire, choisit 0, 1 ou 2 points et rédige un avis ;
 * - l'agent auteur du rapport reçoit en MP un résumé de son rapport (embed, champs de détails
 *   tronqués à 1024 caractères), les points obtenus et l'avis de l'officier ;
 * - le message du rapport est mis à jour avec la notation : le bouton est retiré, un seul
 *   avis est possible par rapport.
 *
 * Le bouton ne doit pas expirer : il est donc traité par un gestionnaire global
 * (events/interactionCreate.js) et jamais par un collector daté. Les customId sont fixes,
 * ce qui les rend utilisables après un redémarrage du bot.
 */

const {
	EmbedBuilder,
	ModalBuilder,
	LabelBuilder,
	TextInputBuilder,
	TextInputStyle,
	StringSelectMenuBuilder,
	MessageFlags,
} = require('discord.js');

const Permissions = require('./Permissions.js');
const Personnel = require('./Personnel.js');

const NOTATION_PERMISSION = 'rapports.suivi';

// Types de rapport notés : prise de service ne rapporte que ses heures (créditées à l'envoi)
// et le rapport concernant le personnel ne rapporte aucune activité.
const RATABLE_REPORT_TYPES = new Set(['incident', 'experience']);

const isRatableReportType = (reportType) => RATABLE_REPORT_TYPES.has(reportType);

const BUTTON_CUSTOM_ID = 'rapport:noter';
// Modal customId : <prefix><threadId>:<messageId>
const MODAL_PREFIX = 'rapport:noter-modal:';
const POINTS_SELECT_CUSTOM_ID = 'rapport:noter-points';
const AVIS_INPUT_CUSTOM_ID = 'avis';

const NOTATION_FIELD_NAME = 'Notation';
const REPORT_TITLE_PREFIX = '📄 ';
// Les détails d'un rapport sont publiés dans le corps du fil juste après son message d'embed,
// en un ou plusieurs messages commençant par cet en-tête (voir commands/rapports/rapports.js).
const DETAILS_HEADER_PATTERN = /^## 🧾 Détails du rapport(?: \(suite \d+\/\d+\))?\n\n?/;
// Limite des valeurs de champ d'embed de Discord : les champs de détails du MP sont tronqués à 1024.
const DM_FIELD_VALUE_LIMIT = 1024;

const POINT_CHOICES = [
	{ label: '0 point', description: 'Rapport peu clair ou peu utile', value: '0' },
	{ label: '1 point', description: 'Rapport utile', value: '1' },
	{ label: '2 points', description: 'Rapport très utile et complet', value: '2' },
];

const truncateValue = (value, limit = DM_FIELD_VALUE_LIMIT) => {
	const text = String(value ?? '');
	if (text.length <= limit) return text;
	return `${text.slice(0, limit - 1)}…`;
};

const getReportAuthorId = (embed) => embed?.description?.match(/^Soumis par .+? \((\d+)\)$/)?.[1] ?? null;

const isReportEmbed = (embed) => typeof embed?.title === 'string' && embed.title.startsWith(REPORT_TITLE_PREFIX);

// Garde-fou : un message de rapport non notable (prise de service, personnel) ne doit jamais
// accepter une notation, même si son bouton a été ajouté par une ancienne version du bot.
const getReportTitle = (reportEmbed) => reportEmbed?.title?.replace(REPORT_TITLE_PREFIX, '') ?? null;
const isRatableReport = (reportEmbed) => {
	const title = getReportTitle(reportEmbed);
	return title === 'Rapport d\'incident' || title === 'Rapport d\'expérience';
};

const getNotationField = (embed) => embed?.fields?.find((field) => field.name === NOTATION_FIELD_NAME) ?? null;

const parseModalReference = (customId) => {
	if (!customId.startsWith(MODAL_PREFIX)) return null;
	const [, , threadId, messageId] = customId.split(':');
	return threadId && messageId ? { threadId, messageId } : null;
};

const extractSelectedPoints = (interaction) => {
	const values = typeof interaction.fields.getStringSelectValues === 'function'
		? interaction.fields.getStringSelectValues(POINTS_SELECT_CUSTOM_ID)
		: (interaction.fields.fields?.get?.(POINTS_SELECT_CUSTOM_ID)?.values ?? []);
	const points = Number(values[0]);
	return Number.isInteger(points) && points >= 0 && points <= 2 ? points : null;
};

// Reconstitution des sections « ### Titre\ncontenu » des détails affichés dans le corps du fil.
const splitDetailSections = (text) => {
	const sections = [];
	let current = null;
	for (const line of String(text ?? '').split('\n')) {
		const titleMatch = line.match(/^### (.+)$/);
		if (titleMatch) {
			current = { title: titleMatch[1].trim(), value: '' };
			sections.push(current);
			continue;
		}
		if (current) current.value = `${current.value}${current.value ? '\n' : ''}${line}`;
	}
	return sections.filter((section) => section.title && section.value.trim())
		.map((section) => ({ ...section, value: section.value.replace(/\s+$/, '') }));
};

// Collecte les messages de détails qui suit le message du rapport et les ramène en champs
// d'embed tronqués à 1024 caractères pour le résumé envoyé à l'auteur.
const collectDetailFields = async (thread, reportMessage) => {
	try {
		const fetched = await thread.messages.fetch({ after: reportMessage.id });
		const messages = [...fetched.values()].sort((left, right) => left.createdTimestamp - right.createdTimestamp);
		const chunks = [];
		for (const message of messages) {
			const content = typeof message.content === 'string' ? message.content : '';
			if (DETAILS_HEADER_PATTERN.test(content)) {
				chunks.push(content.replace(DETAILS_HEADER_PATTERN, ''));
				continue;
			}
			// Les détails suivent immédiatement leur rapport : on s'arrête au rapport suivant.
			if (isReportEmbed(message.embeds?.[0])) break;
		}
		// La découpe en messages est sans perte : on recolle les morceaux tels quels, en insérant
		// simplement un saut de ligne quand la coupure est tombée au milieu d'une ligne.
		const detailText = chunks.reduce((text, chunk, index) => {
			if (!index) return chunk;
			if (text.endsWith('\n') || chunk.startsWith('\n')) return `${text}${chunk}`;
			return `${text}\n${chunk}`;
		}, '');
		return splitDetailSections(detailText).map((section) => ({
			name: truncateValue(section.title, 250),
			value: truncateValue(section.value),
		}));
	}
	catch {
		return [];
	}
};

// L'auteur reçoit uniquement un embed : résumé du rapport (champs tronqués), points obtenus et avis.
const buildAuthorSummaryEmbed = ({ reportEmbed, details = [], points, officerId, avis }) => {
	const reportTitle = reportEmbed.title?.replace(REPORT_TITLE_PREFIX, '') || 'Rapport';
	return new EmbedBuilder()
		.setColor(0x5865f2)
		.setTitle('✅ Évaluation de votre rapport')
		.setDescription(`Votre rapport « ${reportTitle} » a été évalué par <@${officerId}>.`)
		.addFields(
			...(reportEmbed.fields ?? []).map((field) => ({ name: field.name, value: truncateValue(field.value), inline: field.inline })),
			...details.map((field) => ({ name: truncateValue(field.name, 250), value: truncateValue(field.value) })),
			{ name: 'Points accordés', value: `**${points} point${points > 1 ? 's' : ''}**` },
			{ name: 'Avis de l’officier', value: truncateValue(avis) },
		)
		.setTimestamp();
};

const buildNotationValue = (points, officerId, avis) => {
	const header = `${points} point${points > 1 ? 's' : ''}, noté par <@${officerId}>\n\n`;
	return `${header}${truncateValue(avis, Math.max(100, DM_FIELD_VALUE_LIMIT - header.length))}`;
};

const replyEphemeral = (interaction, { title, description, color = 0xed4245 }) => interaction.reply({
	embeds: [new EmbedBuilder().setColor(color).setTitle(title).setDescription(description)],
	flags: MessageFlags.Ephemeral,
});

const handleButton = async (interaction) => {
	if (!Permissions.hasPermission(interaction, NOTATION_PERMISSION)) {
		return replyEphemeral(interaction, {
			title: 'Accès refusé',
			description: 'Vous ne possédez pas la permission rapports.suivi.',
		});
	}

	const reportEmbed = interaction.message.embeds?.[0];
	const authorId = getReportAuthorId(reportEmbed);
	if (!isReportEmbed(reportEmbed) || !authorId) {
		return replyEphemeral(interaction, {
			title: 'Rapport introuvable',
			description: 'Ce message ne correspond pas à un rapport exploitable.',
		});
	}

	if (getNotationField(reportEmbed)) {
		return replyEphemeral(interaction, {
			title: 'Rapport déjà noté',
			description: 'Ce rapport a déjà été évalué.',
			color: 0xfee75c,
		});
	}

	if (!isRatableReport(reportEmbed)) {
		return replyEphemeral(interaction, {
			title: 'Rapport non noté',
			description: 'Seuls les rapports d’incident et d’expérience sont notés.',
		});
	}

	const pointsSelect = new StringSelectMenuBuilder()
		.setCustomId(POINTS_SELECT_CUSTOM_ID)
		.setPlaceholder('Sélectionnez la notation')
		.setMinValues(1)
		.setMaxValues(1)
		.addOptions(POINT_CHOICES);

	const modal = new ModalBuilder()
		// Les identifiants du fil et du message sont encodés dans le modal : le formulaire reste
		// valide après un redémarrage, sans collector ni état en mémoire.
		.setCustomId(`${MODAL_PREFIX}${interaction.channel.id}:${interaction.message.id}`)
		.setTitle('Noter le rapport')
		.addComponents(
			new LabelBuilder()
				.setLabel('Points attribués')
				.setDescription('Choisissez le nombre de points pour ce rapport.')
				.setStringSelectMenuComponent(pointsSelect),
			new LabelBuilder()
				.setLabel('Avis de l’officier')
				.setTextInputComponent(new TextInputBuilder()
					.setCustomId(AVIS_INPUT_CUSTOM_ID)
					.setStyle(TextInputStyle.Paragraph)
					.setRequired(true)
					.setMaxLength(1000)
					.setPlaceholder('Votre avis sur la qualité et la complétude du rapport')),
		);
	await interaction.showModal(modal);
};

const handleModalSubmit = async (interaction) => {
	const reference = parseModalReference(interaction.customId);
	if (!reference) {
		return replyEphemeral(interaction, {
			title: 'Notation impossible',
			description: 'La référence du rapport est introuvable.',
		});
	}

	if (!Permissions.hasPermission(interaction, NOTATION_PERMISSION)) {
		return replyEphemeral(interaction, {
			title: 'Accès refusé',
			description: 'Vous ne possédez plus la permission rapports.suivi.',
		});
	}

	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	// fetch peut rejeter si le fil a été supprimé entre-temps.
	const thread = await interaction.guild?.channels.fetch(reference.threadId)?.catch(() => null) ?? null;

	if (!thread || !thread.messages?.fetch) {
		return interaction.editReply({
			embeds: [new EmbedBuilder()
				.setColor(0xed4245)
				.setTitle('Notation impossible')
				.setDescription('Le fil du rapport est introuvable.')],
		});
	}

	let reportMessage;
	try {
		reportMessage = await thread.messages.fetch(reference.messageId);
	}
	catch {
		return interaction.editReply({
			embeds: [new EmbedBuilder()
				.setColor(0xed4245)
				.setTitle('Notation impossible')
				.setDescription('Le message du rapport est introuvable.')],
		});
	}

	const reportEmbed = reportMessage.embeds?.[0];
	const authorId = getReportAuthorId(reportEmbed);
	if (!isReportEmbed(reportEmbed) || !authorId) {
		return interaction.editReply({
			embeds: [new EmbedBuilder()
				.setColor(0xed4245)
				.setTitle('Notation impossible')
				.setDescription('Le message ciblé ne correspond plus à un rapport exploitable.')],
		});
	}

	if (getNotationField(reportEmbed)) {
		return interaction.editReply({
			embeds: [new EmbedBuilder()
				.setColor(0xfee75c)
				.setTitle('Rapport déjà noté')
				.setDescription('Ce rapport a déjà été évalué.')],
		});
	}

	if (!isRatableReport(reportEmbed)) {
		return interaction.editReply({
			embeds: [new EmbedBuilder()
				.setColor(0xfee75c)
				.setTitle('Rapport non noté')
				.setDescription('Seuls les rapports d’incident et d’expérience sont notés.')],
		});
	}

	const points = extractSelectedPoints(interaction);
	const avis = (interaction.fields.getTextInputValue(AVIS_INPUT_CUSTOM_ID) || '').trim();
	if (points == null || !avis) {
		return interaction.editReply({
			embeds: [new EmbedBuilder()
				.setColor(0xfee75c)
				.setTitle('Formulaire incomplet')
				.setDescription('Sélectionnez un nombre de points (0, 1 ou 2) et rédigez votre avis.')],
		});
	}

	// Crédit des points (0 point => aucun crédit ; l'officier est enregistré comme acteur).
	let pointsResult = { ok: true, credited: 0 };
	if (points > 0) {
		try {
			const credited = await Personnel.addActivityPoints(interaction.client, authorId, points, {
				source: 'rapport',
				reason: `Notation d’un rapport : ${points} point(s)`,
				actorId: interaction.user.id,
			});
			pointsResult = credited.ok ? { ok: true, credited: points } : { ok: false, credited: 0 };
		}
		catch (error) {
			await interaction.client.log('RAPPORT', 'ERROR', `Crédit des points de notation impossible pour <@${authorId}>: ${error.stack || error}`);
			pointsResult = { ok: false, credited: 0 };
		}
	}

	// Le message du rapport affiche la notation et perd son bouton : un seul avis par rapport.
	const postNotation = { edited: false, dmSent: false };
	try {
		const updatedEmbed = EmbedBuilder.from(reportEmbed)
			.setColor(0x57f287)
			.addFields({ name: NOTATION_FIELD_NAME, value: buildNotationValue(points, interaction.user.id, avis), inline: false });
		await reportMessage.edit({ embeds: [updatedEmbed], components: [] });
		postNotation.edited = true;
	}
	catch (error) {
		await interaction.client.log('RAPPORT', 'WARN', `Impossible de mettre à jour le rapport noté ${reference.messageId}: ${error.stack || error}`);
	}

	// Résumé en MP pour l'auteur : un seul embed, champs de détails tronqués à 1024 caractères.
	const detailFields = await collectDetailFields(thread, reportMessage);
	const dmEmbed = buildAuthorSummaryEmbed({ reportEmbed, details: detailFields, points, officerId: interaction.user.id, avis });
	try {
		const author = await interaction.client.users.fetch(authorId);
		postNotation.dmSent = await author.send({ embeds: [dmEmbed] }).then(() => true).catch(() => false);
		if (!postNotation.dmSent) {
			await interaction.client.log('RAPPORT', 'WARN', `Le résumé de notation n’a pas pu être envoyé à l’auteur <@${authorId}>.`);
		}
	}
	catch (error) {
		await interaction.client.log('RAPPORT', 'WARN', `L’auteur du rapport <@${authorId}> est introuvable: ${error.stack || error}`);
	}

	await interaction.client.log('RAPPORT', 'INFO',
		`Rapport ${reference.messageId} noté ${points} point(s) par ${interaction.user.tag} <@${interaction.user.id}> ;`
		+ ` auteur <@${authorId}> ; MP : ${postNotation.dmSent ? 'envoyé' : 'échec'}.`);

	const pointsOk = points === 0 || pointsResult.ok;
	await interaction.editReply({
		embeds: [new EmbedBuilder()
			.setColor(pointsOk && postNotation.edited && postNotation.dmSent ? 0x57f287 : 0xfee75c)
			.setTitle('Notation du rapport')
			.setDescription([
				`Notation enregistrée : **${points} point${points > 1 ? 's' : ''}**.`,
				points === 0
					? 'Aucun point n’a été crédité (notation à 0).'
					: pointsOk
						? `${points} point(s) crédité(s) à l’auteur <@${authorId}>.`
						: `⚠️ Les points n’ont pas pu être crédités à <@${authorId}> (profil absent ?).`,
				postNotation.edited
					? 'Le message du rapport a été mis à jour.'
					: '⚠️ Le message du rapport n’a pas pu être mis à jour.',
				postNotation.dmSent
					? `Le résumé de votre évaluation a été envoyé à l’auteur <@${authorId}> en MP.`
					: `⚠️ Le résumé n’a pas pu être envoyé en MP à l’auteur (mention : <@${authorId}>).`,
			].join('\n\n'))],
	});
};

module.exports = {
	POINT_CHOICES,
	replyEphemeral,
	handleButton,
	handleModalSubmit,
	truncateValue,
	getReportAuthorId,
	isReportEmbed,
	isRatableReportType,
	isRatableReport,
	getReportTitle,
	getNotationField,
	parseModalReference,
	extractSelectedPoints,
	splitDetailSections,
	collectDetailFields,
	buildAuthorSummaryEmbed,
	buildNotationValue,
	BUTTON_CUSTOM_ID,
	MODAL_PREFIX,
	POINTS_SELECT_CUSTOM_ID,
	AVIS_INPUT_CUSTOM_ID,
	NOTATION_FIELD_NAME,
};
