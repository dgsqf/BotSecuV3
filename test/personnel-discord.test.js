const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config.json');
const { getPersonnelRoleIds, getManualRoleDisplays, syncPersonnelRoles, getPersonnelNickname } = require('../framework_utils/PersonnelDiscord.js');

test('personnel roles are lists and rank roles are scoped by branch and division', () => {
	const original = {
		branch: config.personnelBranchRoleIds.BG,
		divisionUlb: config.personnelDivisionRoleIds.ULB,
		divisionUrr: config.personnelDivisionRoleIds.URR,
		rankUlb: config.personnelRankRoleIds.divisions.ULB.recrue,
		rankUrr: config.personnelRankRoleIds.divisions.URR.recrue,
	};
	try {
		config.personnelBranchRoleIds.BG = ['100000000000000001', '100000000000000002'];
		config.personnelDivisionRoleIds.ULB = ['100000000000000003', '100000000000000004'];
		config.personnelDivisionRoleIds.URR = ['100000000000000005'];
		config.personnelRankRoleIds.divisions.ULB.recrue = ['100000000000000006'];
		config.personnelRankRoleIds.divisions.URR.recrue = ['100000000000000007'];
		const ulbRoles = getPersonnelRoleIds({ branch: 'BG', branchRankId: 'agent-premiere-classe', division: 'ULB', divisionRankId: 'recrue' });
		const urrRoles = getPersonnelRoleIds({ branch: 'BG', branchRankId: 'agent-premiere-classe', division: 'URR', divisionRankId: 'recrue' });
		assert.deepEqual(ulbRoles, ['100000000000000001', '100000000000000002', '100000000000000003', '100000000000000004', '1542563548755009647', '100000000000000006']);
		assert.deepEqual(urrRoles, ['100000000000000001', '100000000000000002', '100000000000000005', '1542563548755009647', '100000000000000007']);
		assert.ok(!ulbRoles.includes('100000000000000005'));
		assert.ok(!urrRoles.includes('100000000000000006'));
	}
	finally {
		config.personnelBranchRoleIds.BG = original.branch;
		config.personnelDivisionRoleIds.ULB = original.divisionUlb;
		config.personnelDivisionRoleIds.URR = original.divisionUrr;
		config.personnelRankRoleIds.divisions.ULB.recrue = original.rankUlb;
		config.personnelRankRoleIds.divisions.URR.recrue = original.rankUrr;
	}
});

test('role synchronization removes old division role lists and adds the new division lists', async () => {
	const original = {
		branch: config.personnelBranchRoleIds.BG,
		divisionUlb: config.personnelDivisionRoleIds.ULB,
		divisionUrr: config.personnelDivisionRoleIds.URR,
		branchRank: config.personnelRankRoleIds.branches.BG['agent-premiere-classe'],
		ulbRank: config.personnelRankRoleIds.divisions.ULB.recrue,
		urrRank: config.personnelRankRoleIds.divisions.URR.recrue,
	};
	try {
		config.personnelBranchRoleIds.BG = ['100000000000000101'];
		config.personnelDivisionRoleIds.ULB = ['100000000000000102', '100000000000000103'];
		config.personnelDivisionRoleIds.URR = ['100000000000000104'];
		config.personnelRankRoleIds.branches.BG['agent-premiere-classe'] = ['100000000000000105'];
		config.personnelRankRoleIds.divisions.ULB.recrue = ['100000000000000106', '100000000000000107'];
		config.personnelRankRoleIds.divisions.URR.recrue = ['100000000000000108'];
		let addedRoles = [];
		let removedRoles = [];
		const interaction = {
			guild: {
				members: {
				fetch: async () => ({ roles: {
					add: async (roleIds) => { addedRoles = roleIds; },
					remove: async (roleIds) => { removedRoles = roleIds; },
				}, setNickname: async () => null }),
				},
			},
			client: { log: async () => null },
		};
		const previous = { branch: 'BG', branchRankId: 'agent-premiere-classe', division: 'ULB', divisionRankId: 'recrue' };
		const next = { branch: 'BG', branchRankId: 'agent-premiere-classe', division: 'URR', divisionRankId: 'recrue' };
		const result = await syncPersonnelRoles(interaction, 'member-id', previous, next);
		assert.equal(result.ok, true);
		assert.deepEqual(removedRoles, ['100000000000000102', '100000000000000103', '100000000000000106', '100000000000000107']);
		assert.deepEqual(addedRoles, ['100000000000000104', '100000000000000108']);
	}
	finally {
		config.personnelBranchRoleIds.BG = original.branch;
		config.personnelDivisionRoleIds.ULB = original.divisionUlb;
		config.personnelDivisionRoleIds.URR = original.divisionUrr;
		config.personnelRankRoleIds.branches.BG['agent-premiere-classe'] = original.branchRank;
		config.personnelRankRoleIds.divisions.ULB.recrue = original.ulbRank;
		config.personnelRankRoleIds.divisions.URR.recrue = original.urrRank;
	}
});

test('role synchronization swaps IRA roles when a member changes IRA', async () => {
	const original = {
		iraOne: config.personnelIraRoleIds['1'],
		iraTwo: config.personnelIraRoleIds['2'],
	};
	try {
		config.personnelIraRoleIds['1'] = ['100000000000000201', '100000000000000202'];
		config.personnelIraRoleIds['2'] = ['100000000000000203'];
		let addedRoles = [];
		let removedRoles = [];
		const interaction = {
			guild: {
				members: {
				fetch: async () => ({ roles: {
					add: async (roleIds) => { addedRoles = roleIds; },
					remove: async (roleIds) => { removedRoles = roleIds; },
				}, setNickname: async () => null }),
				},
			},
			client: { log: async () => null },
		};
		const previous = { branch: 'EIT', branchRankId: 'operateur-eit', ira: 1 };
		const next = { branch: 'EIT', branchRankId: 'sergent-eit', ira: 2 };
		await syncPersonnelRoles(interaction, 'member-id', previous, next);
		assert.deepEqual(removedRoles, ['1542563184681025566', '100000000000000201', '100000000000000202']);
		assert.deepEqual(addedRoles, ['1542563061775470674', '100000000000000203']);
	}
	finally {
		config.personnelIraRoleIds['1'] = original.iraOne;
		config.personnelIraRoleIds['2'] = original.iraTwo;
	}
});

test('personnel nicknames capitalize names, drop BG, and keep EIT with a space separator', () => {
	const originalAbbreviations = config.personnelNicknameAbbreviations;
	try {
		config.personnelNicknameAbbreviations = {
			branches: { EIT: 'EIT', BG: 'BG', COMMANDEMENT: 'CMD', DIRECTION: 'DIR', COMMISSION: 'CS' },
			divisions: { ULB: 'ULB', URR: 'URR', UPR: 'UPR', UMS: 'UMS' },
			ranks: { 'agent-premiere-classe': 'A1C.', 'sergent-eit': 'Sgt.', directeur: 'Dir.', recrue: 'Rcr.' },
		};
		// Branche générale : pas de préfixe de branche, pas de division si absente.
		assert.equal(getPersonnelNickname({
			branch: 'BG', branchRankId: 'agent-premiere-classe', division: null, divisionRankId: null,
			firstName: 'jean', lastName: 'DUPONT',
		}), 'A1C. Jean Dupont');
		// Division : la division est le préfixe, sans tiret.
		assert.equal(getPersonnelNickname({
			branch: 'BG', branchRankId: 'agent-premiere-classe', division: 'ULB', divisionRankId: 'recrue',
			firstName: 'MARIE', lastName: 'martin',
		}), 'ULB Rcr. Marie Martin');
		// EIT : préfixe EIT puis le rang, sans tiret.
		assert.equal(getPersonnelNickname({
			branch: 'EIT', branchRankId: 'sergent-eit', division: null, divisionRankId: null,
			firstName: 'paul', lastName: 'durand',
		}), 'EIT Sgt. Paul Durand');
		// Direction : préfixe DIR (ni branche générale, ni division).
		assert.equal(getPersonnelNickname({
			branch: 'DIRECTION', branchRankId: 'directeur', division: null, divisionRankId: null,
			firstName: 'léa', lastName: 'petit',
		}), 'DIR Dir. Léa Petit');
		// Troncature à 32 caractères.
		const long = getPersonnelNickname({
			branch: 'BG', branchRankId: 'agent-premiere-classe', division: null, divisionRankId: null,
			firstName: 'Alexandre-Frédéric', lastName: 'Chastagnerousse',
		});
		assert.ok(long.length <= 32);
	}
	finally {
		config.personnelNicknameAbbreviations = originalAbbreviations;
	}
});

test('manual Direction and Commission roles display only when held by the member', () => {
	const originalDirection = config.personnelManualRoleGroups.Direction;
	const originalCommission = config.personnelManualRoleGroups['Commission de sûreté'];
	try {
		config.personnelManualRoleGroups.Direction = ['100000000000000301', '100000000000000302'];
		config.personnelManualRoleGroups['Commission de sûreté'] = ['100000000000000303'];
		const guild = { roles: { cache: new Map([
			['100000000000000301', { name: 'Directeur de la sécurité' }],
			['100000000000000302', { name: 'Directeur Adjoint de la sécurité' }],
			['100000000000000303', { name: 'Commissaire du conseil de sûreté' }],
		]) } };
		const member = { roles: { cache: new Map([
			['100000000000000301', {}],
			['100000000000000303', {}],
		]) } };
		assert.deepEqual(getManualRoleDisplays(guild, member), [
			'**Direction** : Directeur de la sécurité',
			'**Commission de sûreté** : Commissaire du conseil de sûreté',
		]);
	}
	finally {
		config.personnelManualRoleGroups.Direction = originalDirection;
		config.personnelManualRoleGroups['Commission de sûreté'] = originalCommission;
	}
});

test('Direction and Commission profiles never trigger automatic role assignment', () => {
	assert.deepEqual(getPersonnelRoleIds({ branch: 'DIRECTION', branchRankId: 'directeur', ira: 8 }), []);
	assert.deepEqual(getPersonnelRoleIds({ branch: 'COMMISSION', branchRankId: 'officier-commission', ira: 6 }), []);
});

test('automatic role sync preserves a role configured as manually managed', async () => {
	const originalManualRoles = config.personnelManualRoleGroups.Direction;
	const originalRankRoles = config.personnelRankRoleIds.branches.BG['agent-securite'];
	try {
		const manualRoleId = '100000000000000304';
		config.personnelManualRoleGroups.Direction = [manualRoleId];
		config.personnelRankRoleIds.branches.BG['agent-securite'] = [manualRoleId];
		let removedRoles = [];
		const interaction = {
			guild: { members: { fetch: async () => ({ roles: {
				remove: async (roleIds) => { removedRoles = roleIds; },
				add: async () => null,
			}, setNickname: async () => null }) } },
			client: { log: async () => null },
		};
		await syncPersonnelRoles(interaction, 'member-id', {
			branch: 'BG', branchRankId: 'agent-securite', division: null, divisionRankId: null, ira: 1,
		}, {
			branch: 'BG', branchRankId: 'agent-premiere-classe', division: null, divisionRankId: null, ira: 1,
		});
		assert.ok(!removedRoles.includes(manualRoleId));
	}
	finally {
		config.personnelManualRoleGroups.Direction = originalManualRoles;
		config.personnelRankRoleIds.branches.BG['agent-securite'] = originalRankRoles;
	}
});