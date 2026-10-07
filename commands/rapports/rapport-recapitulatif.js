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

const REPORT_TYPE_ORDER = [
	'Rapport d’incident',
	'Rapport de prise de service',
	'Rapport concernant le personnel',
	'Rapport d’expérience',
];

const canExecute = (interaction) => Permissions.hasPermission(interaction, 'rapports.recapitulatif');

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
		const messages = await getThreadMessages(thread);
		for (const message of messages) {
			if (message.createdTimestamp < startTimestamp || message.createdTimestamp > endTimestamp) continue;
			reports.push(...getReportEntries(message));
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
			.setDescription('Période à inclure dans le récapitulatif.')
			.setRequired(true)
			.addChoices(
				{ name: 'Les 7 derniers jours', value: '7-jours' },
				{ name: 'Le dernier mois', value: '1-mois' },
				{ name: 'La dernière année', value: '1-an' },
			)),
	canExecute,
	async execute(interaction) {
		if (!canExecute(interaction)) return replyAccessDenied(interaction);

		const period = PERIODS[interaction.options.getString('periode', true)];
		if (!period) {
			return interaction.reply({
				content: 'La période sélectionnée est invalide.',
				flags: MessageFlags.Ephemeral,
			});
		}

		const generatedAt = new Date();
		const start = subtractPeriod(generatedAt, period);
		const end = generatedAt;
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
		const filename = `recapitulatif-rapports-${interaction.options.getString('periode', true)}-${formatDate(generatedAt)}.md`;
		await interaction.editReply({
			content: `Récapitulatif généré : ${reports.length} rapport(s) trouvé(s).`,
			files: [new AttachmentBuilder(Buffer.from(markdown, 'utf8'), { name: filename })],
		});
	},
	collectReports,
	getProfileCorrespondences,
	getReportEntries,
	parseReportDate,
	renderMarkdown,
	subtractPeriod,
};
