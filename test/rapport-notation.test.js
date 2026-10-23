const test = require('node:test');
const assert = require('node:assert/strict');

const RapportNotation = require('../framework_utils/RapportNotation.js');

test('splitDetailSections reconstructs the detail sections shown in the thread body', () => {
	const sections = RapportNotation.splitDetailSections(
		'### Personnel notable présent\nAgent A et Agent B\n\n### Détail complet de l\'incident\nDeuxième bloc\nsuite du bloc',
	);
	assert.deepEqual(sections, [
		{ title: 'Personnel notable présent', value: 'Agent A et Agent B' },
		{ title: 'Détail complet de l\'incident', value: 'Deuxième bloc\nsuite du bloc' },
	]);
	assert.deepEqual(RapportNotation.splitDetailSections(''), []);
	assert.deepEqual(RapportNotation.splitDetailSections(null), []);
});

test('truncateValue caps embed field values at 1024 characters', () => {
	assert.equal(RapportNotation.truncateValue('a'.repeat(1024)).length, 1024);
	assert.equal(RapportNotation.truncateValue('a'.repeat(2048)).length, 1024);
	assert.ok(RapportNotation.truncateValue('a'.repeat(2048)).endsWith('…'));
	assert.equal(RapportNotation.truncateValue('court'), 'court');
});

test('getReportAuthorId and getNotationField read the report embed', () => {
	const embed = {
		title: '📄 Rapport d\'incident',
		description: 'Soumis par Agent Exemple (123456789012345678)',
		fields: [],
	};
	assert.equal(RapportNotation.getReportAuthorId(embed), '123456789012345678');
	assert.equal(RapportNotation.isReportEmbed(embed), true);
	assert.equal(RapportNotation.getNotationField(embed), null);

	const rated = { ...embed, fields: [{ name: 'Notation', value: '1 point' }] };
	assert.ok(RapportNotation.getNotationField(rated));
});

test('parseModalReference keeps the persistent thread/message encoding', () => {
	assert.deepEqual(
		RapportNotation.parseModalReference(`${RapportNotation.MODAL_PREFIX}1111111111111111111:2222222222222222222`),
		{ threadId: '1111111111111111111', messageId: '2222222222222222222' },
	);
	assert.equal(RapportNotation.parseModalReference('rapport:autre:1:2'), null);
});

test('extractSelectedPoints accepts only 0, 1 or 2', () => {
	const fakeInteraction = (value) => ({
		fields: { getStringSelectValues: () => (value == null ? [] : [value]) },
	});
	assert.equal(RapportNotation.extractSelectedPoints(fakeInteraction('0')), 0);
	assert.equal(RapportNotation.extractSelectedPoints(fakeInteraction('1')), 1);
	assert.equal(RapportNotation.extractSelectedPoints(fakeInteraction('2')), 2);
	assert.equal(RapportNotation.extractSelectedPoints(fakeInteraction('9')), null);
	assert.equal(RapportNotation.extractSelectedPoints(fakeInteraction('abc')), null);
	assert.equal(RapportNotation.extractSelectedPoints(fakeInteraction(null)), null);
});

test('buildNotationValue stays within the 1024-character embed field limit', () => {
	const value = RapportNotation.buildNotationValue(2, '123', 'a'.repeat(1000));
	assert.ok(value.length <= 1024);
	assert.match(value, /^2 points, noté par <@123>/);

	const zeroValue = RapportNotation.buildNotationValue(0, '123', 'avis');
	assert.match(zeroValue, /^0 point, noté par <@123>/);
});

test('buildAuthorSummaryEmbed truncates detail fields and adds points and the officer review', () => {
	const reportEmbed = {
		title: '📄 Rapport de prise de service',
		description: 'Soumis par Agent Exemple (1234)',
		fields: [{ name: 'Date', value: '<t:1700000000:f>', inline: true }],
	};
	const embed = RapportNotation.buildAuthorSummaryEmbed({
		reportEmbed,
		details: [{ name: 'Détails', value: 'x'.repeat(2000) }],
		points: 1,
		officerId: '999',
		avis: 'y'.repeat(2000),
	});

	const data = embed.data ?? embed;
	assert.ok(data.title.includes('Évaluation de votre rapport'));
	const notationField = data.fields.find((field) => field.name === 'Points accordés');
	assert.equal(notationField.value, '**1 point**');
	const detailField = data.fields.find((field) => field.name === 'Détails');
	assert.equal(detailField.value.length, 1024);
	const avisField = data.fields.find((field) => field.name === 'Avis de l’officier');
	assert.equal(avisField.value.length, 1024);
});

test('collectDetailFields attaches the following detail messages and stops at the next report', async () => {
	const reportMessage = { id: 'report', createdTimestamp: 1 };
	const messages = [
		{ createdTimestamp: 2, content: '## 🧾 Détails du rapport\n\n### Personnel notable présent\nAgent A' },
		{ createdTimestamp: 3, content: `## 🧾 Détails du rapport (suite 2/2)\n\n### Détail complet de l’incident\nSuite${'x'.repeat(2000)}` },
		{ createdTimestamp: 4, content: 'Conversation dans le fil' },
		{ createdTimestamp: 5, embeds: [{ title: '📄 Rapport suivant' }] },
		{ createdTimestamp: 6, content: '## 🧾 Détails du rapport\n\n### Détails du rapport suivant\nÀ ne pas rattacher' },
		{ createdTimestamp: 3.5, content: '## 🧾 Détails du rapport (suite 2/3)\n\n### Détail complet de l’incident\nDeuxième bloc' },
	].sort((left, right) => (left.createdTimestamp ?? 0) - (right.createdTimestamp ?? 0));
	const thread = { messages: { fetch: async () => new Map(messages.map((message) => [message.id ?? `m${message.createdTimestamp}`, message])) } };

	const fields = await RapportNotation.collectDetailFields(thread, reportMessage);
	// Trois sections : la première « Détail complet » est coupée par la limite de message (tronquée),
	// l'en-tête « ### » du message suite ouvre une seconde section du même titre.
	assert.equal(fields.length, 3);
	assert.equal(fields[0].name, 'Personnel notable présent');
	assert.equal(fields[0].value, 'Agent A');
	assert.equal(fields[1].name, 'Détail complet de l’incident');
	assert.ok(fields[1].value.length <= 1024);
	assert.equal(fields[2].value, 'Deuxième bloc');
	assert.ok(fields.every((field) => field.value.length <= 1024));
	assert.equal(fields.some((field) => field.name === 'Détails du rapport suivant'), false);

	const failing = { messages: { fetch: async () => { throw new Error('boom'); } } };
	assert.deepEqual(await RapportNotation.collectDetailFields(failing, reportMessage), []);
});

test('button and modal custom ids are stable and within Discord limits', () => {
	assert.ok(RapportNotation.BUTTON_CUSTOM_ID.length <= 100);
	const modalCustomId = `${RapportNotation.MODAL_PREFIX}1111111111111111111:2222222222222222222`;
	assert.ok(modalCustomId.length <= 100);
});
