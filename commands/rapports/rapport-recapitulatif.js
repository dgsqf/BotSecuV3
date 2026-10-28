const {
	AttachmentBuilder,
	EmbedBuilder,
	MessageFlags,
	SlashCommandBuilder,
} = require('discord.js');
const Permissions = require('../../framework_utils/Permissions.js');
const Personnel = require('../../framework_utils/Personnel.js');
const { rapportForumChannelId } = require('../../config.json');

const PERIODS = {
	'7-jours': { label: 'Les 7 derniers jours', days: 7 },
	'1-mois': { label: 'Le dernier mois', months: 1 },
	'1-an': { label: 'La dernière année', years: 1 },
};

// Les heures saisies dans les options personnalisées sont interprétées en heure de Paris
// (avec le changement d'heure), quel que soit le fuseau du serveur hébergeant le bot.
const TIMEZONE = 'Europe/Paris';

const LOCAL_FORMATTER = new Intl.DateTimeFormat('fr-FR', {
	timeZone: TIMEZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23',
});

// Convertit des composants exprimés en heure de Paris vers un timestamp UTC ; la boucle résout
// le décalage réel (heure d'été/hiver incluse) en comparant l'heure affichée au timestamp testé.
const localParisToUtc = (year, month, day, hour, minute) => {
	const asUtcComponents = Date.UTC(year, month - 1, day, hour, minute);
	let timestamp = asUtcComponents;
	for (let round = 0; round < 3; round += 1) {
		const parts = LOCAL_FORMATTER.formatToParts(new Date(timestamp));
		const value = (type) => Number(parts.find((part) => part.type === type)?.value);
		const difference = asUtcComponents - Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'));
		if (!difference) break;
		timestamp += difference;
	}
	return timestamp;
};

// Analyse « du 19/07/26 19:30 au 20/07/26 6h00 » en bornes [début, fin] en Date.
// Chaque borne accepte : JJ/MM/AA ou JJ/MM/AAAA, avec heure optionnelle HH:MM / HHhMM,
// ou une heure seule (19:30, 6h00, 6h) : la borne garde alors la date de l'autre borne.
const SPLIT_PATTERN = /^(?:du\s+)?(.*?)\s+(?:au|jusqu'?au|à)\s+(.*?)$/iu;
// Date (obligatoire) suivie d'une heure optionnelle.
const DATE_TIME_PATTERN = /^(\d{1,2})\s*[/,.-]\s*(\d{1,2})\s*[/,.-]\s*(\d{2}|\d{4})(?:\s+(\d{1,2})\s*[h:]\s*(\d{1,2})?)?$/;
const TIME_ONLY_PATTERN = /^(\d{1,2})\s*[h:]\s*(\d{1,2})?$/;

const parseRelativeYear = (rawYear) => {
	const year = Number(rawYear);
	return year >= 100 ? year : 2000 + year;
};

const formatParis = (date) => LOCAL_FORMATTER.format(date).replace(',', '');

const parseBound = (raw, otherBound) => {
	const text = String(raw ?? '').trim().toLowerCase();
	if (!text) return null;

	// Heure seule (19:30, 6h00, 6h) : la date vient de l'autre borne ; refusée pour la première.
	if (!/\d{1,2}[/.-]\d{1,2}/.test(text)) {
		return otherBound ? withTime((text.match(TIME_ONLY_PATTERN) || []).slice(1), otherBound) : null;
	}

	const dateMatch = text.match(DATE_TIME_PATTERN);
	if (!dateMatch) return null;
	const bound = {
		year: parseRelativeYear(dateMatch[3]),
		month: Number(dateMatch[2]),
		day: Number(dateMatch[1]),
	};
	if (dateMatch[4] != null) {
		Object.assign(bound, {
			hour: Number(dateMatch[4]),
			minute: Number(dateMatch[5] ?? 0),
		});
	}
	// Date sans heure : 00:00 pour un début, 23:59 pour une fin (journée complète).
	bound.hour ??= otherBound ? 23 : 0;
	bound.minute ??= otherBound ? 59 : 0;
	if (bound.month < 1 || bound.month > 12 || bound.day < 1 || bound.day > 31
		|| bound.hour > 23 || bound.minute > 59) return null;
	// Refuse les dates inexistantes (31/02...) : la relecture en heure de Paris doit redonner les mêmes composants.
	const timestamp = localParisToUtc(bound.year, bound.month, bound.day, bound.hour, bound.minute);
	const round = LOCAL_FORMATTER.formatToParts(new Date(timestamp));
	const shown = (type) => Number(round.find((part) => part.type === type)?.value);
	if (shown('year') !== bound.year || shown('month') !== bound.month || shown('day') !== bound.day
		|| shown('hour') !== bound.hour || shown('minute') !== bound.minute) return null;
	return { ...bound, timestamp };
};

const withTime = ([hour = null, minute = null], bound) => {
	// Complète l'autre borne avec l'heure demandée (minute absente = 00).
	if (!hour || hour > 23 || Number(minute ?? 0) > 59) return null;
	return { ...bound, hour: Number(hour), minute: Number(minute ?? 0) };
};

// Renvoie { start, end, label : ... } ou { error : message explicite }, bornes inclusives.
const parseCustomRange = (text) => {
	const splitMatch = String(text ?? '').trim().match(SPLIT_PATTERN);
	const usage = 'Écrivez par exemple « du 19/07/26 19:30 au 20/07/26 6h00 » (heure de Paris).';
	if (!splitMatch) return { error: usage };
	const [, rawStart, rawEnd] = splitMatch;
	if (!rawStart || !rawEnd) return { error: usage };

	const start = parseBound(rawStart, null);
	if (!start) return { error: `La date de début « ${rawStart.trim()} » n'a pas été reconnue. Formats acceptés : 19/07/26 19:30, 19/07/2026 6h00, 19/07/26 (heure de Paris).` };
	const end = parseBound(rawEnd, start);
	if (!end) return { error: `La date de fin « ${rawEnd.trim()} » n'a pas été reconnue. Formats acceptés : 20/07/26 6h00, 6h00, 6h30, 20/07/26 (heure de Paris).` };
	if (end.timestamp <= start.timestamp) {
		return { error: 'La date de fin doit être postérieure à la date de début.' };
	}
	return {
		start: new Date(start.timestamp),
		end: new Date(end.timestamp),
		label: `du ${formatParis(new Date(start.timestamp))} au ${formatParis(new Date(end.timestamp))} (heure de Paris)`,
	};
};
const REPORT_TYPE_ORDER = [
	'Rapport d’incident',
	'Rapport de prise de service',
	'Rapport concernant le personnel',
	'Rapport d’expérience',
];

const canExecute = (interaction) => Permissions.hasPermission(interaction, 'rapports.recapitulatif');


// Les détails d'un rapport sont publiés dans le fil juste après son message d'embed, en un ou
// plusieurs messages commençant par cet en-tête (voir commands/rapports/rapports.js).
const DETAILS_BODY_HEADER = '## 🧾 Détails du rapport';
const DETAILS_HEADER_PATTERN = /^## 🧾 Détails du rapport(?: \(suite \d+\/\d+\))?\n\n?/;

const isDetailMessage = (message) =>
	typeof message.content === 'string' && message.content.startsWith(DETAILS_BODY_HEADER);

const stripDetailHeader = (content) => content.replace(DETAILS_HEADER_PATTERN, '').trim();

const subtractPeriod = (date, period) => {
	const start = new Date(date);
	if (period.days) {
		start.setUTCDate(start.getUTCDate() - period.days);
		return start;
	}

	const day = start.getUTCDate();
	start.setUTCDate(1);
	if (period.months) start.setUTCMonth(start.getUTCMonth() - period.months);
	if (period.years) start.setUTCFullYear(start.getUTCFullYear() - period.years);
	const lastDayOfMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
	start.setUTCDate(Math.min(day, lastDayOfMonth));
	return start;
};

const getField = (embed, name) => embed.fields?.find((field) => field.name === name)?.value ?? null;

const parseReportDate = (value, fallbackTimestamp) => {
	const discordTimestamp = typeof value === 'string' ? value.match(/<t:(\d+)(?::[tTdDfFR])?>/) : null;
	if (discordTimestamp) {
		const timestamp = Number(discordTimestamp[1]) * 1_000;
		return Number.isFinite(timestamp)
			? { timestamp, label: new Date(timestamp).toISOString().slice(0, 10) }
			: { timestamp: fallbackTimestamp, label: new Date(fallbackTimestamp).toISOString().slice(0, 10) };
	}
	if (value) return { timestamp: fallbackTimestamp, label: String(value).trim() };
	return { timestamp: fallbackTimestamp, label: new Date(fallbackTimestamp).toISOString().slice(0, 10) };
};

const getThreadMessages = async (thread) => {
	const messages = new Map();
	let before;
	let hasMore = true;
	while (hasMore) {
		const batch = await thread.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
		for (const message of batch.values()) messages.set(message.id, message);
		if (batch.size < 100) {
			hasMore = false;
			continue;
		}

		const oldestMessage = [...batch.values()].reduce((oldest, message) =>
			!oldest || message.createdTimestamp < oldest.createdTimestamp ? message : oldest, null);
		if (!oldestMessage || oldestMessage.id === before) {
			throw new Error(`La pagination des rapports a échoué dans le fil ${thread.id}.`);
		}
		before = oldestMessage.id;
	}

	return [...messages.values()];
};

const getReportEntries = (message) => (message.embeds || []).flatMap((embed) => {
	if (!embed.title?.startsWith('📄 Rapport')) return [];
	const type = getField(embed, 'Type') || embed.title.replace(/^📄\s*/, '');
	const reportDate = parseReportDate(getField(embed, 'Date'), message.createdTimestamp);
	const submittedBy = embed.description?.match(/^Soumis par (.+?) \((\d+)\)$/);
	return [{
		type,
		title: embed.title.replace(/^📄\s*/, ''),
		reportDate,
		submittedTimestamp: message.createdTimestamp,
		author: submittedBy ? `${submittedBy[1]} (<@${submittedBy[2]}>)` : (embed.description || 'Non renseigné'),
		discordUsername: submittedBy?.[1] ?? null,
		discordUserId: submittedBy?.[2] ?? null,
		fields: (embed.fields || []).filter((field) => field.name !== 'Type' && field.name !== 'Date'),
		details: [],
		url: message.url,
	}];
});

const compareReports = (left, right) => {
	const dateDifference = left.reportDate.timestamp - right.reportDate.timestamp;
	if (dateDifference) return dateDifference;
	const leftTypeOrder = REPORT_TYPE_ORDER.indexOf(left.type);
	const rightTypeOrder = REPORT_TYPE_ORDER.indexOf(right.type);
	const typeDifference = (leftTypeOrder < 0 ? REPORT_TYPE_ORDER.length : leftTypeOrder)
		- (rightTypeOrder < 0 ? REPORT_TYPE_ORDER.length : rightTypeOrder);
	if (typeDifference) return typeDifference;
	return left.submittedTimestamp - right.submittedTimestamp;
};

const collectReports = async (forumChannel, startTimestamp, endTimestamp) => {
	const active = await forumChannel.threads.fetchActive();
	const archived = await forumChannel.threads.fetchArchived({ type: 'public', fetchAll: true });
	const threads = new Map();
	for (const thread of active.threads.values()) threads.set(thread.id, thread);
	for (const thread of archived.threads.values()) threads.set(thread.id, thread);

	const reports = [];
	for (const thread of threads.values()) {
		// Les messages de détails suivent immédiatement leur rapport dans le thread : on lit le fil
		// dans l'ordre chronologique et on rattache chaque message de détails au dernier rapport vu.
		const messages = [...await getThreadMessages(thread)].sort((left, right) => left.createdTimestamp - right.createdTimestamp);
		const threadReports = [];
		let lastReport = null;
		for (const message of messages) {
			const entries = getReportEntries(message);
			if (entries.length) {
				lastReport = entries[entries.length - 1];
				threadReports.push(...entries);
				continue;
			}
			if (isDetailMessage(message) && lastReport) lastReport.details.push(stripDetailHeader(message.content));
		}
		for (const report of threadReports) {
			if (report.submittedTimestamp < startTimestamp || report.submittedTimestamp > endTimestamp) continue;
			reports.push(report);
		}
	}
	return reports.sort(compareReports);
};

const formatDate = (date) => date.toISOString().slice(0, 10);

const escapeTableCell = (value) => String(value).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim();

const getProfileCorrespondences = async (reports) => {
	const authors = new Map();
	for (const report of reports) {
		if (!report.discordUserId || authors.has(report.discordUserId)) continue;
		authors.set(report.discordUserId, {
			discordUsername: report.discordUsername || report.discordUserId,
			discordUserId: report.discordUserId,
		});
	}

	const correspondences = await Promise.all([...authors.values()].map(async (author) => {
		const profile = await Personnel.getProfile(author.discordUserId);
		return {
			...author,
			rpName: profile ? `${profile.firstName} ${profile.lastName}`.trim() : 'Aucun profil RP associé',
		};
	}));
	return correspondences.sort((left, right) =>
		left.discordUsername.localeCompare(right.discordUsername, 'fr')
		|| left.discordUserId.localeCompare(right.discordUserId));
};

const renderMarkdown = (reports, period, start, end, generatedAt, profileCorrespondences = []) => {
	const lines = [
		'# Récapitulatif des rapports',
		'',
		`- **Compte rendu généré le :** ${generatedAt.toISOString()}`,
		`- **Période :** ${period.label}`,
		`- **Rapports publiés entre :** ${start.toISOString()} et ${end.toISOString()}`,
		`- **Nombre de rapports :** ${reports.length}`,
		'',
		'## Correspondance des profils',
		'',
		'| Pseudonyme Discord | Nom RP |',
		'| --- | --- |',
		...(profileCorrespondences.length
			? profileCorrespondences.map(({ discordUsername, discordUserId, rpName }) =>
				`| ${escapeTableCell(`@${discordUsername} (<@${discordUserId}>)`)} | ${escapeTableCell(rpName)} |`)
			: ['| Aucun auteur de rapport sur la période | — |']),
		'',
	];

	if (reports.length === 0) {
		lines.push('Aucun rapport n’a été publié pendant cette période.');
		return `${lines.join('\n')}\n`;
	}

	const reportsByDate = new Map();
	for (const report of reports) {
		const day = formatDate(new Date(report.reportDate.timestamp));
		if (!reportsByDate.has(day)) reportsByDate.set(day, new Map());
		const reportsByType = reportsByDate.get(day);
		if (!reportsByType.has(report.type)) reportsByType.set(report.type, []);
		reportsByType.get(report.type).push(report);
	}

	for (const [day, reportsByType] of reportsByDate) {
		lines.push(`## ${day}`, '');
		for (const [type, typeReports] of reportsByType) {
			lines.push(`### ${type}`, '');
			for (const report of typeReports) {
				lines.push(`#### ${report.title}`, '');
				lines.push(`- **Auteur :** ${report.author}`);
				lines.push(`- **Date du rapport :** ${report.reportDate.label}`);
				if (report.url) lines.push(`- **Rapport original :** ${report.url}`);
				lines.push('');
				for (const field of report.fields) {
					lines.push(`**${field.name}**`, '', field.value, '');
				}
				if (report.details?.length) {
					// La découpe en messages conserve les sauts de ligne : la concaténation restitue le texte d'origine.
					lines.push('**Détails**', '', report.details.join(''), '');
				}
			}
		}
	}

	return `${lines.join('\n').trimEnd()}\n`;
};

const replyAccessDenied = (interaction) => interaction.reply({
	embeds: [new EmbedBuilder()
		.setColor(0xed4245)
		.setTitle('Accès refusé')
		.setDescription('Vous ne possédez pas la permission rapports.recapitulatif.')],
	flags: MessageFlags.Ephemeral,
});

module.exports = {
	cooldown: 30,
	data: new SlashCommandBuilder()
		.setName('rapport-recapitulatif')
		.setDescription('Génère un fichier Markdown avec les rapports publiés sur une période.')
		.addStringOption((option) => option
			.setName('periode')
			.setDescription('Période prédéfinie ou « du 19/07/26 19:30 au 20/07/26 6h00 » (heure de Paris).')
			.setRequired(true)
			.setMaxLength(120)),
	canExecute,
	async execute(interaction) {
		if (!canExecute(interaction)) return replyAccessDenied(interaction);

		const periodeInput = interaction.options.getString('periode', true);
		const generatedAt = new Date();
		let start;
		let end;
		let period;
		if (PERIODS[periodeInput]) {
			period = PERIODS[periodeInput];
			start = subtractPeriod(generatedAt, period);
			end = generatedAt;
		}
		else {
			const custom = parseCustomRange(periodeInput, generatedAt);
			if (custom.error) {
				return interaction.reply({
					embeds: [new EmbedBuilder()
						.setColor(0xfee75c)
						.setTitle('Période non reconnue')
						.setDescription(custom.error)],
					flags: MessageFlags.Ephemeral,
				});
			}
			start = custom.start;
			end = custom.end;
			period = { label: custom.label };
		}
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const forumChannelId = process.env.RAPPORT_FORUM_CHANNEL_ID || rapportForumChannelId;
		if (!forumChannelId) throw new Error('Le salon forum des rapports n’est pas configuré.');
		const forumChannel = await interaction.guild.channels.fetch(forumChannelId);
		if (!forumChannel?.threads?.fetchActive || !forumChannel.threads.fetchArchived) {
			throw new Error('Le salon configuré pour les rapports n’est pas un forum Discord valide.');
		}

		const reports = await collectReports(forumChannel, start.getTime(), end.getTime());
		const profileCorrespondences = await getProfileCorrespondences(reports);
		const markdown = renderMarkdown(reports, period, start, end, generatedAt, profileCorrespondences);
		const filename = `recapitulatif-rapports-${start.toISOString().slice(0, 10)}-${end.toISOString().slice(0, 10)}.md`;
		await interaction.editReply({
			content: `Récapitulatif généré : ${reports.length} rapport(s) trouvé(s).`,
			files: [new AttachmentBuilder(Buffer.from(markdown, 'utf8'), { name: filename })],
		});
	},
	collectReports,
	isDetailMessage,
	stripDetailHeader,
	getProfileCorrespondences,
	getReportEntries,
	parseReportDate,
	renderMarkdown,
	subtractPeriod,
	localParisToUtc,
	parseCustomRange,
};
