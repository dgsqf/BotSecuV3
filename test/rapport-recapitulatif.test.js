const test = require('node:test');
const assert = require('node:assert/strict');
const recapitulatif = require('../commands/rapports/rapport-recapitulatif.js');

test('report periods use calendar-aware start dates', () => {
	const now = new Date('2024-03-31T12:00:00.000Z');
	assert.equal(recapitulatif.subtractPeriod(now, { days: 7 }).toISOString(), '2024-03-24T12:00:00.000Z');
	assert.equal(recapitulatif.subtractPeriod(now, { months: 1 }).toISOString(), '2024-02-29T12:00:00.000Z');
	assert.equal(recapitulatif.subtractPeriod(new Date('2024-02-29T12:00:00.000Z'), { years: 1 }).toISOString(), '2023-02-28T12:00:00.000Z');
});

test('report entries include report date, author, and all report fields', () => {
	const [report] = recapitulatif.getReportEntries({
		createdTimestamp: 1_700_000_000_000,
		url: 'https://discord.com/channels/guild/thread/message',
		embeds: [{
			title: '📄 Rapport d’incident',
			description: 'Soumis par Agent Exemple (123456789012345678)',
			fields: [
				{ name: 'Type', value: 'Rapport d’incident' },
				{ name: 'Date', value: '<t:1700000000:f>' },
				{ name: 'Lieu', value: 'Secteur 1' },
			],
		}],
	});
	assert.equal(report.reportDate.label, '2023-11-14');
	assert.equal(report.author, 'Agent Exemple (<@123456789012345678>)');
	assert.equal(report.discordUsername, 'Agent Exemple');
	assert.equal(report.discordUserId, '123456789012345678');
	assert.deepEqual(report.fields, [{ name: 'Lieu', value: 'Secteur 1' }]);
});

test('profile correspondence resolves RP names once per author and preserves unmapped authors', async () => {
	const personnel = require('../framework_utils/Personnel.js');
	const originalGetProfile = personnel.getProfile;
	const lookedUpIds = [];
	personnel.getProfile = async (discordUserId) => {
		lookedUpIds.push(discordUserId);
		return discordUserId === '123456789012345678'
			? { firstName: 'Jean', lastName: 'Dupont' }
			: null;
	};
	try {
		const correspondences = await recapitulatif.getProfileCorrespondences([
			{ discordUsername: 'Agent', discordUserId: '123456789012345678' },
			{ discordUsername: 'Agent', discordUserId: '123456789012345678' },
			{ discordUsername: 'Autre', discordUserId: '223456789012345678' },
		]);
		assert.equal(lookedUpIds.length, 2);
		assert.deepEqual(correspondences, [
			{ discordUsername: 'Agent', discordUserId: '123456789012345678', rpName: 'Jean Dupont' },
			{ discordUsername: 'Autre', discordUserId: '223456789012345678', rpName: 'Aucun profil RP associé' },
		]);
	}
	finally {
		personnel.getProfile = originalGetProfile;
	}
});

test('Markdown groups reports by chronological date and then report type', () => {
	const reports = [
		{
			type: 'Rapport de prise de service',
			title: 'Rapport de prise de service',
			reportDate: { timestamp: Date.parse('2025-01-02T09:00:00.000Z'), label: '2025-01-02' },
			submittedTimestamp: Date.parse('2025-01-02T09:05:00.000Z'),
			author: 'Agent B',
			fields: [{ name: 'Personnel présent', value: 'Agent B' }],
		},
		{
			type: 'Rapport d’incident',
			title: 'Rapport d’incident',
			reportDate: { timestamp: Date.parse('2025-01-02T08:00:00.000Z'), label: '2025-01-02' },
			submittedTimestamp: Date.parse('2025-01-02T08:05:00.000Z'),
			author: 'Agent A',
			fields: [{ name: 'Lieu', value: 'Secteur 2' }],
		},
		{
			type: 'Rapport d’incident',
			title: 'Rapport d’incident',
			reportDate: { timestamp: Date.parse('2025-01-01T08:00:00.000Z'), label: '2025-01-01' },
			submittedTimestamp: Date.parse('2025-01-01T08:05:00.000Z'),
			author: 'Agent C',
			fields: [],
		},
	];
	const markdown = recapitulatif.renderMarkdown(
		reports.sort((left, right) => left.reportDate.timestamp - right.reportDate.timestamp),
		{ label: 'Les 7 derniers jours' },
		new Date('2025-01-01T00:00:00.000Z'),
		new Date('2025-01-08T00:00:00.000Z'),
		new Date('2025-01-08T00:00:00.000Z'),
		[
			{
				discordUsername: 'Agent | Un',
				discordUserId: '123456789012345678',
				rpName: 'Jean Dupont',
			},
		],
	);
	assert.ok(markdown.indexOf('## 2025-01-01') < markdown.indexOf('## 2025-01-02'));
	assert.ok(markdown.indexOf('### Rapport d’incident') < markdown.indexOf('### Rapport de prise de service'));
	assert.match(markdown, /Secteur 2/);
	assert.match(markdown, /Compte rendu généré le/);
	assert.match(markdown, /\| @Agent \\| Un \(<@123456789012345678>\) \| Jean Dupont \|/);
});

test('an empty period produces a valid Markdown summary', () => {
	const markdown = recapitulatif.renderMarkdown(
		[],
		{ label: 'Le dernier mois' },
		new Date('2025-01-01T00:00:00.000Z'),
		new Date('2025-02-01T00:00:00.000Z'),
		new Date('2025-02-01T00:00:00.000Z'),
	);
	assert.match(markdown, /Nombre de rapports :\*\* 0/);
	assert.match(markdown, /Aucun rapport n’a été publié/);
});

test('detail messages are split at 2000 characters with continuation headers restored losslessly', () => {
	const rapports = require('../commands/rapports/rapports.js');
	// 3000 caractères ; 2000 caractères/message, marge incluse pour l'en-tête de reprise.
	const longText = 'ligne\n'.repeat(500);
	const messages = rapports.buildDetailMessages(longText);
	assert.equal(messages.length, 2);
	for (const message of messages) {
		assert.ok(message.content.length <= 2000);
		assert.match(message.content, /^## 🧾 Détails du rapport/);
	}
	assert.doesNotMatch(messages[0].content, /suite/);
	assert.match(messages[1].content, /^## 🧾 Détails du rapport \(suite 2\/2\)/);

	// Reconstitution fidèle (la découpe conserve les sauts de ligne), comme le fait /rapport-recapitulatif
	const reassembled = messages
		.map((message) => message.content.replace(/^## 🧾 Détails du rapport(?: \(suite \d+\/\d+\))?\n\n/, ''))
		.join('');
	assert.equal(reassembled, longText.trim());
});

test('a very long single-section detail is hard-split into compliant messages', () => {
	const rapports = require('../commands/rapports/rapports.js');
	const messages = rapports.buildDetailMessages('a'.repeat(5000));
	assert.equal(messages.length, 3);
	for (const message of messages) assert.ok(message.content.length <= 2000);
});

test('collectReports attaches detail messages to the preceding report and ignores threads without reports', async () => {
	const makeReport = (id, createdTimestamp, extraFields) => ({
		id,
		createdTimestamp,
		url: `https://discord.com/channels/guild/thread/${id}`,
		embeds: [{
			title: '📄 Rapport d’incident',
			description: 'Soumis par Agent Exemple (123456789012345678)',
			fields: [{ name: 'Type', value: 'Rapport d’incident' }, { name: 'Date', value: '<t:1700000000:f>' }, ...extraFields],
		}],
	});
	const detailsMessageSuffix = ' (suite 2/2)\n\n### Détail complet de l’incident\nDeuxième bloc';
	const messages = [
		makeReport('report', 1_700_000_025_000, []),
		{ id: 'details-1', createdTimestamp: 1_700_000_026_000, content: '## 🧾 Détails du rapport\n\n### Personnel notable présent\nAgent A' },
		{ id: 'details-2', createdTimestamp: 1_700_000_027_000, content: `## 🧾 Détails du rapport${detailsMessageSuffix}` },
		{ id: 'chat', createdTimestamp: 1_700_000_028_000, content: 'Discussion classique dans le fil, ce ne sont pas des détails.' },
	];
	const thread = { id: 'thread', messages: { fetch: async () => new Map(messages.map((message) => [message.id, message])) } };
	const forum = { threads: { fetchActive: async () => ({ threads: new Map([[thread.id, thread]]) }), fetchArchived: async () => ({ threads: new Map() }) } };

	const [report] = await recapitulatif.collectReports(forum, 1_700_000_000_000, 1_700_000_100_000);
	assert.deepEqual(report.details, [
		'### Personnel notable présent\nAgent A',
		'### Détail complet de l’incident\nDeuxième bloc',
	]);
});

test('renderMarkdown includes merged report details after the other fields', () => {
	const markdown = recapitulatif.renderMarkdown([
		{
			type: 'Rapport d’incident',
			title: 'Rapport d’incident',
			reportDate: { timestamp: Date.parse('2025-01-02T08:00:00.000Z'), label: '2025-01-02' },
			submittedTimestamp: Date.parse('2025-01-02T08:05:00.000Z'),
			author: 'Agent A',
			fields: [{ name: 'Lieu', value: 'Secteur 2' }],
			details: ['### Personnel notable présent\nAgent A', '### Détail complet de l’incident\nLong récit'],
		},
	],
	{ label: 'Les 7 derniers jours' },
	new Date('2025-01-01T00:00:00.000Z'),
	new Date('2025-01-08T00:00:00.000Z'),
	new Date('2025-01-08T00:00:00.000Z'),
	[]);
	assert.match(markdown, /\*\*Lieu\*\*/);
	assert.match(markdown, /\*\*Détails\*\*[\s\S]*### Personnel notable présent[\s\S]*Long récit/);
	// les en-têtes de reprise ne doivent pas rester dans le récapitulatif
	assert.doesNotMatch(markdown, /Détails du rapport \(suite/);
});

test('recapitulatif detail constants match the report command', () => {
	// Le marqueur exact produit par /rapport doit être reconnu par /rapport-recapitulatif.
	const rapports = require('../commands/rapports/rapports.js');
	assert.equal(recapitulatif.isDetailMessage({ content: `${rapports.DETAILS_BODY_HEADER} (suite 2/3)\n\ntexte` }), true);
	assert.equal(recapitulatif.stripDetailHeader(`${rapports.DETAILS_BODY_HEADER} (suite 2/3)\n\ntexte`), 'texte');
	assert.equal(recapitulatif.isDetailMessage({ content: '## 🧾 Détails du rapport (suite 2/3)\n\ntexte' }), true);
	assert.equal(recapitulatif.isDetailMessage({ content: '## 🧾 Détails du rapport\ntexte' }), true);
	assert.equal(recapitulatif.isDetailMessage({ content: 'Message normal' }), false);
});

test('collectReports searches active and archived threads and filters by publication date', async () => {
	const makeReportMessage = (id, createdTimestamp, reportDate) => ({
		id,
		createdTimestamp,
		url: `https://discord.com/channels/guild/thread/${id}`,
		embeds: [{
			title: '📄 Rapport d’incident',
			description: 'Soumis par Agent Exemple (123456789012345678)',
			fields: [
				{ name: 'Type', value: 'Rapport d’incident' },
				{ name: 'Date', value: `<t:${Math.floor(reportDate / 1_000)}:f>` },
				{ name: 'Lieu', value: 'Secteur 1' },
			],
		}],
	});
	const makeThread = (id, messages) => ({
		id,
		messages: { fetch: async () => new Map(messages.map((message) => [message.id, message])) },
	});
	const activeThread = makeThread('active', [
		makeReportMessage('published-in-period', 1_700_000_025_000, 1_700_000_050_000),
		makeReportMessage('published-before-period', 1_699_999_999_000, 1_700_000_025_000),
	]);
	const archivedThread = makeThread('archived', [makeReportMessage('archived-report', 1_700_000_050_000, 1_700_000_075_000)]);
	let archivedOptions;
	const forum = {
		threads: {
			fetchActive: async () => ({ threads: new Map([[activeThread.id, activeThread]]) }),
			fetchArchived: async (options) => {
				archivedOptions = options;
				return { threads: new Map([[archivedThread.id, archivedThread], [activeThread.id, activeThread]]) };
			},
		},
	};

	const reports = await recapitulatif.collectReports(forum, 1_700_000_000_000, 1_700_000_100_000);
	assert.deepEqual(reports.map(({ url }) => url), [
		'https://discord.com/channels/guild/thread/published-in-period',
		'https://discord.com/channels/guild/thread/archived-report',
	]);
	assert.deepEqual(archivedOptions, { type: 'public', fetchAll: true });
});
