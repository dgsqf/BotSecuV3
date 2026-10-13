const createRank = (id, label, ira) => ({ id, label, ira });

const ladders = {
	EIT: [
		createRank('recrue-eit', 'Recrue EIT', 2),
		createRank('operateur-eit', 'Opérateur EIT', 2),
		createRank('sergent-eit', 'Sergent EIT', 3),
		createRank('adjudant-eit', 'Adjudant EIT', 3),
		createRank('major-eit', 'Major EIT', 4),
		createRank('lieutenant-eit', 'Lieutenant EIT', 5),
		createRank('capitaine-eit', 'Capitaine des Agents d’Intervention Tactique', 6),
	],
	BG: [
		createRank('agent-securite', 'Agent de sécurité', 1),
		createRank('agent-premiere-classe', 'Agent de première classe', 1),
		createRank('caporal', 'Caporal', 2),
		createRank('caporal-chef', 'Caporal-chef', 2),
		createRank('sergent', 'Sergent', 3),
		createRank('adjudant', 'Adjudant', 3),
		createRank('major', 'Major', 4),
		createRank('lieutenant', 'Lieutenant', 5),
		createRank('capitaine-equipes', 'Capitaine des Équipes de sécurité', 6),
	],
	COMMANDEMENT: [
		createRank('commandant-operations', 'Commandant des opérations', 7),
		createRank('chef-securite', 'Chef de la sécurité', 7),
	],
	DIRECTION: [
		createRank('directeur-adjoint', 'Directeur adjoint de la sécurité', 8),
		createRank('directeur', 'Directeur de la sécurité', 8),
	],
	COMMISSION: [
		createRank('officier-commission', 'Officier de commission de sûreté', 6),
		createRank('commissaire-conseil-surete', 'Commissaire du conseil de sûreté', 7),
	],
};

const divisionLadders = {
	ULB: [
		createRank('recrue', 'Recrue', 1),
		createRank('operateur', 'Opérateur', 2),
		createRank('sergent', 'Sergent', 3),
		createRank('adjudant', 'Adjudant', 3),
		createRank('major', 'Major', 4),
		createRank('lieutenant', 'Lieutenant', 5),
	],
	URR: [
		createRank('recrue', 'Recrue', 1),
		createRank('operateur', 'Opérateur', 2),
		createRank('sergent', 'Sergent', 3),
		createRank('adjudant', 'Adjudant', 3),
		createRank('major', 'Major', 4),
		createRank('lieutenant', 'Lieutenant', 5),
	],
	UPR: [
		createRank('recrue', 'Recrue', 1),
		createRank('agent-protection', 'Agent de protection', 2),
		createRank('responsable-equipe', 'Responsable d’équipe', 3),
		createRank('major', 'Major', 4),
		createRank('lieutenant', 'Lieutenant', 5),
	],
	UMS: [
		createRank('recrue', 'Recrue', 1),
		createRank('agent-medicale', 'Agent médical', 2),
		createRank('major', 'Major', 4),
		createRank('lieutenant', 'Lieutenant', 5),
	],
};

const divisionToBgRank = {
	recrue: 'agent-premiere-classe',
	operateur: 'caporal',
	'agent-medicale': 'caporal',
	'agent-protection': 'caporal-chef',
	'responsable-equipe': 'sergent',
	sergent: 'sergent',
	adjudant: 'adjudant',
	major: 'major',
	lieutenant: 'lieutenant',
};

const allRanks = [...Object.values(ladders), ...Object.values(divisionLadders)].flat();
const ranksById = new Map(allRanks.map((rank) => [rank.id, rank]));

const getLadder = (branch, division = null) => {
	if (branch === 'BG' && division) return divisionLadders[division] || [];
	return ladders[branch] || [];
};

const getRank = (id) => ranksById.get(id) || null;

const getNextRank = (ladder, currentRankId) => {
	if (!Array.isArray(ladder)) return null;
	const currentIndex = ladder.findIndex((rank) => rank.id === currentRankId);
	return currentIndex < 0 ? null : ladder[currentIndex + 1] || null;
};

const mapDivisionRankToBg = (divisionRankId) => divisionToBgRank[divisionRankId] || null;

// Équivalence branche → division : titre de division équivalent à un rang de branche.
// Pour BG, on suit la table de correspondance divisionToBgRank : le titre est le rang de division
// dont l'équivalent BG est atteint dans l'échelle de branche (le plus haut possible). Lorsqu'aucun
// rang de division n'est équivalent au palier franchi (ex. UMS entre Caporal et Major), le titre
// reste au rang en dessous.
// Pour EIT, le rang de branche appartient à l'échelle EIT ; la direction décide du mouvement :
// « up » (vague de promotion) fait avancer le titre d'un cran de l'échelle de division s'il ne
// dépasse pas l'IRA du palier de branche ; « down » (rétrogradation) redescend au titre le plus
// proche en dessous ; « sync » (réglage manuel) prend le titre le plus haut ≤ à l'IRA du palier.
const getDivisionTitleForBranchRankId = (branchRankId, division, branch = 'BG', currentDivisionRankId = null, direction = 'sync') => {
	const divisionLadder = divisionLadders[division];
	if (!Array.isArray(divisionLadder)) return null;
	const branchRank = ladders[branch]?.find((rank) => rank.id === branchRankId);
	if (!branchRank) return null;
	if (branch !== 'BG') {
		const currentIndex = divisionLadder.findIndex((rank) => rank.id === currentDivisionRankId);
		if (direction === 'up') {
			if (currentIndex >= divisionLadder.length - 1) return null;
			const candidate = divisionLadder[Math.max(currentIndex + 1, 0)];
			return candidate.ira <= branchRank.ira ? candidate : null;
		}
		if (direction === 'down') {
			for (let index = Math.max(currentIndex, divisionLadder.length - 1); index >= 0; index -= 1) {
				if (divisionLadder[index].ira <= branchRank.ira) return divisionLadder[index];
			}
			return divisionLadder[0];
		}
		const eligible = divisionLadder.filter((rank) => rank.ira <= branchRank.ira);
		return eligible[eligible.length - 1] || null;
	}
	const branchIndex = ladders.BG.findIndex((rank) => rank.id === branchRankId);
	if (branchIndex < 0) return null;
	let best = null;
	for (const rank of divisionLadder) {
		const mapped = ladders.BG.find((entry) => entry.id === divisionToBgRank[rank.id]);
		if (!mapped) continue;
		const mappedIndex = ladders.BG.indexOf(mapped);
		// Le titre ne peut ni dépasser le niveau du rang de branche (index) ni dépasser son IRA :
		// un palier sans équivalent laisse le titre au rang en dessous.
		if (mappedIndex >= 0 && mappedIndex <= branchIndex && mapped.ira <= branchRank.ira) best = rank;
	}
	return best;
};

const computeIra = ({ branch, branchRankId, division = null, divisionRankId = null } = {}) => {
	// L'IRA suit la hiérarchie de branche, même si le titre de division reste en dessous
	// (palier sans équivalent dans la division).
	const ladder = getLadder(branch) || [];
	const branchRank = ladder.find((rank) => rank.id === branchRankId);
	if (branchRank) return branchRank.ira;

	if (branch === 'BG' && division) {
		if (!divisionLadders[division]) throw new Error(`Division invalide : ${division}.`);
		const divisionRank = divisionLadders[division].find((rank) => rank.id === divisionRankId);
		if (!divisionRank) throw new Error(`Rang de division invalide : ${divisionRankId || 'non renseigné'}.`);
		return divisionRank.ira;
	}

	throw new Error(`Rang invalide pour la branche ${branch || 'non renseignée'} : ${branchRankId || 'non renseigné'}.`);
};

module.exports = {
	getLadder,
	getRank,
	getNextRank,
	mapDivisionRankToBg,
	getDivisionTitleForBranchRankId,
	computeIra,
};