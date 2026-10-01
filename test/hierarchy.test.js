const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config.json');
const {
	getLadder,
	getRank,
	getNextRank,
	mapDivisionRankToBg,
	computeIra,
} = require('../data/hierarchy.js');

test('hiérarchies de branche et de division sont ordonnées du bas vers le haut', () => {
	assert.equal(getLadder('EIT')[0].id, 'recrue-eit');
	assert.equal(getLadder('EIT').at(-1).id, 'capitaine-eit');
	assert.equal(getLadder('BG')[0].id, 'agent-securite');
	assert.equal(getLadder('BG').at(-1).id, 'capitaine-equipes');
	assert.deepEqual(getLadder('BG', 'ULB').map(({ id }) => id), getLadder('BG', 'URR').map(({ id }) => id));
	assert.deepEqual(getLadder('BG', 'UPR').map(({ id }) => id), ['recrue', 'agent-protection', 'responsable-equipe', 'major', 'lieutenant']);
	assert.deepEqual(getLadder('BG', 'UMS').map(({ id }) => id), ['recrue', 'agent-medicale', 'major', 'lieutenant']);
	assert.equal(getLadder('COMMANDEMENT').length, 2);
	assert.deepEqual(getLadder('DIRECTION').map(({ id }) => id), ['directeur-adjoint', 'directeur']);
	assert.deepEqual(getLadder('COMMISSION').map(({ id }) => id), ['officier-commission', 'commissaire-conseil-surete']);
});

test('getRank and getNextRank return rank metadata and stop at the ladder summit', () => {
	const ladder = getLadder('BG');
	assert.equal(getRank('caporal').ira, 2);
	assert.equal(getNextRank(ladder, 'agent-securite').id, 'agent-premiere-classe');
	assert.equal(getNextRank(ladder, 'capitaine-equipes'), null);
	assert.equal(getNextRank(ladder, 'inconnu'), null);
	assert.equal(getRank('inconnu'), null);
});

test('division ranks map to BG ranks, including rank jumps', () => {
	assert.equal(mapDivisionRankToBg('recrue'), 'agent-premiere-classe');
	assert.equal(mapDivisionRankToBg('operateur'), 'caporal');
	assert.equal(mapDivisionRankToBg('agent-medicale'), 'caporal');
	assert.equal(mapDivisionRankToBg('agent-protection'), 'caporal-chef');
	assert.equal(mapDivisionRankToBg('responsable-equipe'), 'sergent');
	assert.equal(mapDivisionRankToBg('sergent'), 'sergent');
	assert.equal(mapDivisionRankToBg('adjudant'), 'adjudant');
	assert.equal(mapDivisionRankToBg('major'), 'major');
	assert.equal(mapDivisionRankToBg('lieutenant'), 'lieutenant');
	assert.equal(mapDivisionRankToBg('inconnu'), null);
});

test('computeIra follows branch ranks and each BG division rank', () => {
	assert.equal(computeIra({ branch: 'EIT', branchRankId: 'sergent-eit' }), 3);
	assert.equal(computeIra({ branch: 'BG', branchRankId: 'agent-securite' }), 1);
	assert.equal(computeIra({ branch: 'DIRECTION', branchRankId: 'directeur-adjoint' }), 8);
	assert.equal(computeIra({ branch: 'DIRECTION', branchRankId: 'directeur' }), 8);
	assert.equal(computeIra({ branch: 'COMMISSION', branchRankId: 'officier-commission' }), 6);
	assert.equal(computeIra({ branch: 'COMMISSION', branchRankId: 'commissaire-conseil-surete' }), 7);
	for (const division of ['ULB', 'URR', 'UPR', 'UMS']) {
		assert.equal(computeIra({ branch: 'BG', branchRankId: 'agent-premiere-classe', division, divisionRankId: 'recrue' }), 1);
	}
	assert.equal(computeIra({ branch: 'BG', division: 'UPR', divisionRankId: 'responsable-equipe' }), 3);
	assert.equal(computeIra({ branch: 'BG', division: 'UMS', divisionRankId: 'major' }), 4);
	assert.throws(() => computeIra({ branch: 'BG', division: 'ULB', divisionRankId: 'inconnu' }), /Rang de division invalide/);
});

test('configured rank limits only refer to ranks present in their branch or division', () => {
	for (const [branch, limits] of Object.entries(config.personnelRankLimits.branches)) {
		for (const rankId of Object.keys(limits)) {
			assert.ok(getLadder(branch).some(({ id }) => id === rankId), `${branch}.${rankId} must exist`);
			assert.equal(limits[rankId], 1);
		}
	}
	for (const [division, limits] of Object.entries(config.personnelRankLimits.divisions)) {
		for (const rankId of Object.keys(limits)) {
			assert.ok(getLadder('BG', division).some(({ id }) => id === rankId), `BG.${division}.${rankId} must exist`);
			assert.equal(limits[rankId], 1);
		}
	}
});