const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../framework_utils/Database.js');
const Permissions = require('../framework_utils/Permissions.js');
const personnel = require('../framework_utils/Personnel.js');
const { getLadder } = require('../data/hierarchy.js');
const config = require('../config.json');
const personnelCommand = require('../commands/personnel/personnel.js');
const { renderDashboard, executeDashboard } = require('../framework_utils/PersonnelDashboardSession.js');

let database;
let temporaryDirectory;

test.beforeEach(() => {
	temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'botsecu-personnel-'));
	database = openDatabase(path.join(temporaryDirectory, 'personnel.sqlite'));
	personnel.setDatabase(database);
});

test.afterEach(() => {
	database.close();
	fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const addProfile = (discordId, branch, rankId, division = null) => personnel.createProfile({
	discordId,
	firstName: 'Jean',
	lastName: 'Test',
	branch,
	rankId,
	division,
});

test('a database profile grants private self-info access without staff roles', async () => {
	assert.equal(personnel.hasProfile('self-info-user'), false);
	await addProfile('self-info-user', 'EIT', 'recrue-eit');
	assert.equal(personnel.hasProfile('self-info-user'), true);
	assert.equal(personnelCommand.canExecute({ user: { id: 'self-info-user' }, member: { roles: { cache: new Set() } } }), true);

	const interaction = {
		user: { id: 'self-info-user', tag: 'self-info-user' },
		member: { roles: { cache: new Set() } },
	};
	const dashboardState = { interaction, userTag: interaction.user.tag, view: 'characters', page: 'characters', backPage: 'home', hasOwnProfile: true, activityType: 'points', activityPeriod: 'all', activityPage: 1, activityPages: 1, historyPage: 1, historyPages: 1, promotionIds: [], promotionLabels: [], scaleIndex: 0 };
	const components = renderDashboard(dashboardState).components.flatMap((row) => row.components);
	assert.ok(components.some((component) => component.data.custom_id === 'personnel:self-profile'));
	assert.ok(!components.some((component) => component.data.custom_id === 'personnel:create-profile'));
	assert.ok(!components.some((component) => component.data.custom_id === 'personnel:delete-profile'));
});

test('profile directory is paginated and includes every saved character', async () => {
	for (let index = 0; index < 12; index++) {
		await addProfile(`directory-${String(index).padStart(2, '0')}`, 'EIT', 'recrue-eit');
	}
	const first = personnel.getProfiles({ limit: 10, page: 1 });
	const second = personnel.getProfiles({ limit: 10, page: 2 });
	assert.equal(first.totalRows, 12);
	assert.equal(first.totalPages, 2);
	assert.equal(first.rows.length, 10);
	assert.equal(second.rows.length, 2);
	assert.equal(new Set([...first.rows, ...second.rows].map(({ discordId }) => discordId)).size, 12);
	assert.equal(personnel.getProfileDiscordIds().length, 12);
});

test('profile directory shows the real Discord username next to the member ping', async () => {
	const discordId = '100000000000000099';
	await addProfile(discordId, 'EIT', 'recrue-eit');
	let collect;
	let latestPayload;
	const staffRoleId = Permissions.getRoleIds('personnel.dossier')[0];
	const message = { createMessageComponentCollector: () => ({ on: (event, callback) => { if (event === 'collect') collect = callback; } }) };
	const interaction = {
		user: { id: '100000000000000098', tag: 'directory-staff' },
		member: { roles: { cache: new Set([staffRoleId]) } },
		guild: { members: { fetch: async () => new Map() }, roles: { cache: new Map() } },
		client: { users: { fetch: async (userId) => ({ id: userId, username: 'vrai_pseudo' }) }, log: async () => null },
		reply: async (payload) => { latestPayload = payload; },
		fetchReply: async () => message,
		editReply: async (payload) => { latestPayload = payload; },
	};
	await executeDashboard(interaction);
	await collect({ user: interaction.user, member: interaction.member, customId: 'personnel:list-profiles', deferred: false, deferUpdate: async function() { this.deferred = true; } });
	assert.match(latestPayload.embeds[0].data.description, /vrai_pseudo/);
	assert.match(latestPayload.embeds[0].data.description, new RegExp(`<@${discordId}>`));
	assert.match(latestPayload.embeds[0].data.description, /Jean Test/);
});

test('directory controls are reserved for members with dossier permission', () => {
	const roleId = Permissions.getRoleIds('personnel.dossier')[0];
	const renderFor = (roles) => renderDashboard({
		interaction: { member: { roles: { cache: new Set(roles) } } },
		userTag: 'directory-viewer',
		view: 'characters',
		page: 'characters',
		backPage: 'home',
		hasOwnProfile: true,
	});
	const privateButtons = renderFor([]).components.flatMap((componentRow) => componentRow.components).map((component) => component.data.custom_id);
	const staffButtons = renderFor([roleId]).components.flatMap((componentRow) => componentRow.components).map((component) => component.data.custom_id);
	assert.ok(!privateButtons.includes('personnel:list-profiles'));
	assert.ok(!privateButtons.includes('personnel:list-security-unregistered'));
	assert.ok(staffButtons.includes('personnel:list-profiles'));
	assert.ok(staffButtons.includes('personnel:list-security-unregistered'));
});

test('security directory excludes existing profiles and bot accounts', async () => {
	const registeredId = '100000000000000101';
	const unregisteredId = '100000000000000102';
	const botId = '100000000000000103';
	await addProfile(registeredId, 'BG', 'agent-securite');
	const securityRoleId = config.UrgenceDivisions.brancheGen.roleId;
	const members = new Map([
		[registeredId, { id: registeredId, user: { id: registeredId, tag: 'registered#0001', bot: false }, displayName: 'Registered', roles: { cache: new Set([securityRoleId]) } }],
		[unregisteredId, { id: unregisteredId, user: { id: unregisteredId, tag: 'unregistered#0001', bot: false }, displayName: 'Unregistered', roles: { cache: new Set([securityRoleId]) } }],
		[botId, { id: botId, user: { id: botId, tag: 'bot#0001', bot: true }, displayName: 'Bot', roles: { cache: new Set([securityRoleId]) } }],
	]);
	let collect;
	let latestPayload;
	const memberRoleId = Permissions.getRoleIds('personnel.dossier')[0];
	const message = { createMessageComponentCollector: () => ({ on: (event, callback) => { if (event === 'collect') collect = callback; } }) };
	const interaction = {
		user: { id: '100000000000000199', tag: 'dossier-staff' },
		member: { roles: { cache: new Set([memberRoleId]) } },
		guild: { members: { fetch: async () => members }, roles: { cache: new Map() } },
		client: { log: async () => null },
		reply: async (payload) => { latestPayload = payload; },
		fetchReply: async () => message,
		editReply: async (payload) => { latestPayload = payload; },
	};
	await executeDashboard(interaction);
	const component = {
		user: interaction.user,
		member: interaction.member,
		customId: 'personnel:list-security-unregistered',
		deferred: false,
		deferUpdate: async function() { this.deferred = true; },
	};
	await collect(component);
	assert.equal(latestPayload.embeds[0].data.title, '🛡️ Sécurité sans profil');
	assert.match(latestPayload.embeds[0].data.description, new RegExp(unregisteredId));
	assert.doesNotMatch(latestPayload.embeds[0].data.description, new RegExp(registeredId));
	assert.doesNotMatch(latestPayload.embeds[0].data.description, new RegExp(botId));
});

test('dashboard navigates views and self profile by editing its original response', async () => {
	await addProfile('dashboard-user', 'EIT', 'recrue-eit');
	let collect;
	let replyCount = 0;
	const edits = [];
	const message = {
		createMessageComponentCollector: () => ({
			on: (event, callback) => { if (event === 'collect') collect = callback; },
			stop: () => false,
		}),
	};
	const interaction = {
		user: { id: 'dashboard-user', tag: 'dashboard-user' },
		member: { roles: { cache: new Set() } },
		guild: { members: { fetch: async () => null }, roles: { cache: new Map() } },
		client: { log: async (_module, _severity, logMessage) => { logs.push(logMessage); } },
		reply: async (payload) => { replyCount++; edits.push(payload); },
		fetchReply: async () => message,
		editReply: async (payload) => { edits.push(payload); },
	};
	const logs = [];
	await executeDashboard(interaction);
	assert.equal(replyCount, 1);
	assert.equal(edits[0].embeds[0].data.title, '👥 Personnages');
	assert.ok(edits[0].components.flatMap((componentRow) => componentRow.components).some((component) => component.data.custom_id === 'personnel:view'));

	const viewComponent = {
		user: interaction.user,
		member: interaction.member,
		customId: 'personnel:view',
		values: ['characters'],
		deferred: false,
		deferUpdate: async function() { this.deferred = true; },
	};
	await collect(viewComponent);
	assert.equal(edits.length, 2);
	assert.equal(edits[1].embeds[0].data.title, '👥 Personnages');

	const profileComponent = {
		user: interaction.user,
		member: interaction.member,
		customId: 'personnel:self-profile',
		deferred: false,
		deferUpdate: async function() { this.deferred = true; },
	};
	await collect(profileComponent);
	assert.equal(edits.at(-1).embeds[0].data.title, '👤 Jean Test');
	assert.ok(!edits.at(-1).embeds[0].data.fields.some((field) => field.name === '🧩 Fonctions manuelles'));
	profileComponent.deferred = false;
	const originalGetProfile = personnel.getProfile;
	personnel.getProfile = async () => { throw new Error('simulated dashboard failure'); };
	try {
		await collect(profileComponent);
	}
	finally {
		personnel.getProfile = originalGetProfile;
	}
	assert.equal(profileComponent.deferred, true);
	assert.equal(replyCount, 1);
	assert.match(edits.at(-1).embeds[0].data.fields.find((field) => field.name === '⚠️ Opération impossible').value, /simulated dashboard failure/);
	assert.match(logs[0], /personnel:self-profile/);
	assert.match(logs[0], /dashboard-user/);
	assert.match(logs[0], /simulated dashboard failure/);
});

test('deleting a profile leaves its Discord roles untouched', async () => {
	const targetId = '100000000000000211';
	await addProfile(targetId, 'BG', 'agent-securite');
	let collect;
	let memberFetchCount = 0;
	const roleIds = [...Permissions.getRoleIds('personnel.admin'), ...Permissions.getRoleIds('personnel.dossier')];
	const member = { id: targetId, user: { tag: 'member#0001' }, displayName: 'Member', roles: { cache: new Set() } };
	const message = { createMessageComponentCollector: () => ({ on: (event, callback) => { if (event === 'collect') collect = callback; } }) };
	const interaction = {
		user: { id: '100000000000000212', tag: 'admin#0001' },
		member: { roles: { cache: new Set(roleIds) } },
		guild: {
			members: { fetch: async () => { memberFetchCount++; return member; } },
			roles: { cache: new Map() },
		},
		client: { log: async () => null },
		reply: async () => null,
		fetchReply: async () => message,
		editReply: async () => null,
	};
	await executeDashboard(interaction);
	const click = async (customId, values = []) => collect({
		user: interaction.user,
		member: interaction.member,
		customId: `personnel:${customId}`,
		values,
		deferred: false,
		deferUpdate: async function() { this.deferred = true; },
	});
	await click('select-profile');
	await click('profile-member', [targetId]);
	await click('delete-profile');
	await click('delete-confirm');
	assert.equal(await personnel.getProfile(targetId), null);
	assert.equal(memberFetchCount, 0, 'deleting a database profile must not fetch the member or modify Discord roles');
});

test('previewPromotion advances EIT and BG members by one rank', async () => {
	await addProfile('eit', 'EIT', 'operateur-eit');
	const eit = await personnel.previewPromotion('eit');
	assert.equal(eit.from.branchRankId, 'operateur-eit');
	assert.equal(eit.to.branchRankId, 'sergent-eit');
	assert.equal(eit.from.ira, 2);
	assert.equal(eit.to.ira, 3);
	assert.equal(eit.iraChanged, true);

	await addProfile('bg', 'BG', 'agent-securite');
	const bg = await personnel.previewPromotion('bg');
	assert.equal(bg.to.branchRankId, 'agent-premiere-classe');
	assert.equal(bg.to.divisionRankId, null);
	assert.equal(bg.iraChanged, false);
});

test('previewPromotion follows each BG division ladder and its BG mapping', async () => {
	const expected = {
		ULB: ['operateur', 'caporal', 2],
		URR: ['operateur', 'caporal', 2],
		UPR: ['agent-protection', 'caporal-chef', 2],
		UMS: ['agent-medicale', 'caporal', 2],
	};
	for (const [index, [division, [divisionRankId, branchRankId, ira]]] of Object.entries(expected).entries()) {
		const discordId = `division-${index}`;
		await addProfile(discordId, 'BG', 'recrue', division);
		const preview = await personnel.previewPromotion(discordId);
		assert.equal(preview.to.divisionRankId, divisionRankId);
		assert.equal(preview.to.branchRankId, branchRankId);
		assert.equal(preview.to.ira, ira);
		assert.equal(preview.iraChanged, true);
	}
});

test('setDivision defaults to recruit, recalculates BG rank, and preserves BG rank on exit', async () => {
	await addProfile('division-change', 'BG', 'agent-securite');
	const joined = await personnel.setDivision('division-change', 'UPR');
	assert.equal(joined.divisionRankId, 'recrue');
	assert.equal(joined.branchRankId, 'agent-premiere-classe');
	assert.equal(joined.ira, 1);
	await personnel.setDivision('division-change', 'UPR', 'responsable-equipe');
	const beforeExit = await personnel.getProfile('division-change');
	const left = await personnel.setDivision('division-change', null);
	assert.equal(left.division, null);
	assert.equal(left.branchRankId, beforeExit.branchRankId);
	assert.equal(left.ira, beforeExit.ira);
	await assert.rejects(() => personnel.setDivision('division-change', 'EIT'), /Division invalide/);
});

test('setBranch changes branch or division and resets to a valid rank and IRA', async () => {
	await addProfile('branch-change', 'EIT', 'sergent-eit');
	const bg = await personnel.setBranch('branch-change', 'BG');
	assert.equal(bg.branch, 'BG');
	assert.equal(bg.branchRankId, 'agent-securite');
	assert.equal(bg.ira, 1);
	const division = await personnel.setBranch('branch-change', 'BG', 'UMS', 'agent-medicale');
	assert.equal(division.division, 'UMS');
	assert.equal(division.branchRankId, 'caporal');
	assert.equal(division.divisionRankId, 'agent-medicale');
	assert.equal(division.ira, 2);
	const eit = await personnel.setBranch('branch-change', 'EIT', null, 'recrue-eit');
	assert.equal(eit.branch, 'EIT');
	assert.equal(eit.division, null);
	assert.equal(eit.ira, 2);
	// EIT peut aussi porter une division : la bascule EIT + division est acceptée.
	const eitDivision = await personnel.setBranch('branch-change', 'EIT', 'ULB', 'recrue');
	assert.equal(eitDivision.branch, 'EIT');
	assert.equal(eitDivision.division, 'ULB');
	assert.equal(eitDivision.divisionRankId, 'recrue');
	await assert.rejects(() => personnel.setBranch('branch-change', 'COMMANDEMENT', 'ULB'), /Seules les branches BG et EIT/);
});

test('Direction and Commission profiles use independent rank ladders', async () => {
	const director = await addProfile('direction-profile', 'DIRECTION', 'directeur-adjoint');
	assert.equal(director.branch, 'DIRECTION');
	assert.equal(director.ira, 8);
	const directorPromotion = await personnel.previewPromotion('direction-profile');
	assert.equal(directorPromotion.to.branchRankId, 'directeur');
	assert.equal(directorPromotion.to.ira, 8);

	const commissioner = await addProfile('commission-profile', 'COMMISSION', 'officier-commission');
	assert.equal(commissioner.branch, 'COMMISSION');
	assert.equal(commissioner.ira, 6);
	const commissionPromotion = await personnel.previewPromotion('commission-profile');
	assert.equal(commissionPromotion.to.branchRankId, 'commissaire-conseil-surete');
	assert.equal(commissionPromotion.to.ira, 7);
	assert.equal(getLadder('COMMISSION').some(({ id }) => id === 'representant-departement'), false);
	await assert.rejects(() => addProfile('invalid-commission-rank', 'COMMISSION', 'directeur'), /Ce rang n’appartient pas/);
	await assert.rejects(() => personnel.createProfile({
		discordId: 'commission-division',
		firstName: 'Camille',
		lastName: 'Sureté',
		branch: 'COMMISSION',
		division: 'ULB',
	}), /Seules les branches BG et EIT/);
});

test('rank capacity rejects active overflow and releases a slot for inactive profiles', async () => {
	const originalLimit = config.personnelRankLimits.branches.COMMISSION['officier-commission'];
	config.personnelRankLimits.branches.COMMISSION['officier-commission'] = 1;
	try {
		await addProfile('commission-cap-1', 'COMMISSION', 'officier-commission');
		await assert.rejects(
			() => addProfile('commission-cap-2', 'COMMISSION', 'officier-commission'),
			/est complet \(1\/1 membres actifs\)/,
		);
		await personnel.updateInfo('commission-cap-1', { status: 'inactive' });
		const nextProfile = await addProfile('commission-cap-2', 'COMMISSION', 'officier-commission');
		assert.equal(nextProfile.status, 'active');
		await assert.rejects(
			() => personnel.updateInfo('commission-cap-1', { status: 'active' }),
			/est complet \(1\/1 membres actifs\)/,
		);
	}
	finally {
		config.personnelRankLimits.branches.COMMISSION['officier-commission'] = originalLimit;
	}
});

test('rank capacity blocks promotions, manual rank changes, branch changes, and demotions', async () => {
	const originalLimits = structuredClone(config.personnelRankLimits);
	try {
		config.personnelRankLimits.branches.COMMISSION['officier-commission'] = 2;
		config.personnelRankLimits.branches.COMMISSION['commissaire-conseil-surete'] = 2;
		await addProfile('limit-officer-1', 'COMMISSION', 'officier-commission');
		await addProfile('limit-officer-2', 'COMMISSION', 'officier-commission');
		await addProfile('limit-comm-1', 'COMMISSION', 'commissaire-conseil-surete');
		await addProfile('limit-comm-2', 'COMMISSION', 'commissaire-conseil-surete');
		await addProfile('limit-eit', 'EIT', 'recrue-eit');
		await addProfile('limit-director', 'DIRECTION', 'directeur');
		config.personnelRankLimits.branches.COMMISSION['officier-commission'] = 1;
		config.personnelRankLimits.branches.COMMISSION['commissaire-conseil-surete'] = 1;
		config.personnelRankLimits.branches.DIRECTION.directeur = 1;

		assert.equal((await personnel.previewPromotion('limit-officer-2')).ok, false);
		const promotions = await personnel.applyPromotions(
			{ log: async () => null },
			'issuer',
			[{ discordId: 'limit-officer-2' }],
		);
		assert.equal(promotions.succès.length, 0);
		assert.match(promotions.échecs[0].reason, /est complet/);
		await assert.rejects(
			() => personnel.setRank('limit-officer-2', 'commissaire-conseil-surete'),
			/est complet/,
		);
		await assert.rejects(
			() => personnel.demoteMember('limit-comm-2'),
			/est complet/,
		);
		await assert.rejects(
			() => personnel.setBranch('limit-eit', 'DIRECTION', null, 'directeur'),
			/est complet/,
		);
		await addProfile('limit-bg', 'BG', 'agent-securite');
		await addProfile('limit-ulb', 'BG', 'recrue', 'ULB');
		config.personnelRankLimits.divisions.ULB = { lieutenant: 1 };
		await addProfile('limit-ulb-2', 'BG', 'recrue', 'ULB');
		await personnel.setRank('limit-ulb-2', 'lieutenant');
		await addProfile('limit-bg-2', 'BG', 'agent-securite');
		await assert.rejects(
			() => personnel.setDivision('limit-bg-2', 'ULB', 'lieutenant'),
			/est complet/,
		);
	}
	finally {
		config.personnelRankLimits = originalLimits;
	}
});

test('previewPromotion rejects summit ranks and ranks other than the next step', async () => {
	await addProfile('summit', 'EIT', 'capitaine-eit');
	assert.deepEqual(await personnel.previewPromotion('summit'), { ok: false, reason: 'Le membre est déjà au sommet de son échelle.' });
	await addProfile('target', 'BG', 'agent-securite');
	assert.equal((await personnel.previewPromotion('target', 'caporal')).ok, false);
	assert.equal((await personnel.previewPromotion('absent')).ok, false);
});

test('applyPromotions applies one rank and stores no promotion history', async () => {
	await addProfile('race', 'BG', 'agent-securite');
	const result = await personnel.applyPromotions({ log: async () => null }, 'issuer', [{ discordId: 'race' }], 'note');
	assert.equal(result.succès.length, 1);
	assert.equal((await personnel.getProfile('race')).branchRankId, 'agent-premiere-classe');
	assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sqlite_master WHERE type = \'table\' AND name LIKE \'%promotion%\'').get().count, 0);
});

test('applyPromotions detects a concurrent rank change through its conditional update', async () => {
	await addProfile('concurrent', 'BG', 'agent-securite');
	database.exec(`
		CREATE TRIGGER concurrent_rank_change BEFORE UPDATE OF branch_rank_id ON members
		WHEN OLD.discord_id = 'concurrent'
		BEGIN
			UPDATE members SET branch_rank_id = 'agent-premiere-classe' WHERE discord_id = 'concurrent';
			SELECT RAISE(IGNORE);
		END;
	`);
	const result = await personnel.applyPromotions({ log: async () => null }, 'issuer', [{ discordId: 'concurrent' }], 'note');
	assert.equal(result.succès.length, 0);
	assert.match(result.échecs[0].reason, /rang a changé/);
	assert.equal((await personnel.getProfile('concurrent')).branchRankId, 'agent-premiere-classe');
});

test('activity writes totals and logs atomically and returns NO_PROFILE without throwing', async () => {
	await addProfile('activity', 'BG', 'agent-securite');
	const client = { log: async () => null };
	await personnel.addActivityPoints(client, 'activity', 4, { source: 'rapport', reason: 'test', actorId: 'staff' });
	await personnel.removeActivity(client, 'activity', { type: 'points', amount: -1, source: 'correction', reason: 'doublon', actorId: 'staff' });
	await personnel.addActivityHours(client, 'activity', 1.25, { source: 'manuel', reason: 'test', actorId: 'staff' });
	assert.equal((await personnel.getProfile('activity')).activityPoints, 3);
	assert.equal((await personnel.getProfile('activity')).activityMinutes, 75);
	assert.equal(database.prepare('SELECT COUNT(*) AS count FROM activity_logs').get().count, 3);
	assert.deepEqual(await personnel.addActivityPoints(client, 'missing', 1, { source: 'test', reason: 'test', actorId: 'staff' }), { ok: false, reason: 'NO_PROFILE' });
	assert.equal(database.prepare('SELECT COUNT(*) AS count FROM activity_logs').get().count, 3);
});

test('sanction case numbers increment atomically and revocation is persisted', async () => {
	await addProfile('sanctioned', 'BG', 'agent-securite');
	const first = await personnel.addSanction('sanctioned', 'Avertissement', 'Premier motif', 'issuer');
	const second = await personnel.addSanction('sanctioned', 'Blâme', 'Second motif', 'issuer');
	assert.equal(first.case_number, 1);
	assert.equal(second.case_number, 2);
	assert.equal(await personnel.getActiveSanctionCount('sanctioned'), 2);
	await personnel.revokeSanction(first.case_number, 'revoker', 'Motif de révocation');
	assert.equal(await personnel.getActiveSanctionCount('sanctioned'), 1);
	assert.equal((await personnel.getSanctions('sanctioned', { includeRevoked: true })).rows.length, 2);
});