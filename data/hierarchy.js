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

const computeIra = ({ branch, branchRankId, division = null, divisionRankId = null } = {}) => {
	if (branch === 'BG' && division) {
		if (!divisionLadders[division]) throw new Error(`Division invalide : ${division}.`);
		const divisionRank = divisionLadders[division].find((rank) => rank.id === divisionRankId);
		if (!divisionRank) throw new Error(`Rang de division invalide : ${divisionRankId || 'non renseigné'}.`);
		return divisionRank.ira;
	}

	const branchRank = getLadder(branch).find((rank) => rank.id === branchRankId);
	if (!branchRank) throw new Error(`Rang invalide pour la branche ${branch || 'non renseignée'} : ${branchRankId || 'non renseigné'}.`);
	return branchRank.ira;
};

module.exports = {
	getLadder,
	getRank,
	getNextRank,
	mapDivisionRankToBg,
	computeIra,
};