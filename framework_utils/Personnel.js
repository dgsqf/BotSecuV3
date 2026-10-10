/* Les autres modules appellent addActivityPoints(client, discordId, amount, { source, reason, actorId }) et addActivityHours(client, discordId, hours, { source, reason, actorId }) pour enregistrer une activité. */
const config = require('../config.json');
const {
	getLadder,
	getRank,
	getNextRank,
	mapDivisionRankToBg,
	computeIra,
} = require('../data/hierarchy.js');

let database = null;

const setDatabase = (connection) => {
	if (!connection || typeof connection.prepare !== 'function') throw new TypeError('Une connexion SQLite valide est requise.');
	database = connection;
};

const getDatabase = () => {
	if (!database?.open) throw new Error('La base de données du personnel n’est pas initialisée.');
	return database;
};

const mapMember = (row) => row ? ({
	discordId: row.discord_id,
	firstName: row.first_name,
	lastName: row.last_name,
	branch: row.branch,
	branchRankId: row.branch_rank_id,
	division: row.division,
	divisionRankId: row.division_rank_id,
	ira: row.ira,
	activityPoints: row.activity_points,
	activityMinutes: row.activity_minutes,
	status: row.status,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
}) : null;

const getProfile = async (discordId) => {
	if (typeof discordId !== 'string' || !discordId.trim()) throw new Error('L’identifiant Discord est invalide.');
	return mapMember(getDatabase().prepare('SELECT * FROM members WHERE discord_id = ?').get(discordId));
};

const hasProfile = (discordId) => {
	if (typeof discordId !== 'string' || !discordId.trim()) return false;
	return Boolean(getDatabase().prepare('SELECT 1 FROM members WHERE discord_id = ?').get(discordId));
};

const getProfileDiscordIds = () => getDatabase()
	.prepare('SELECT discord_id FROM members')
	.all()
	.map(({ discord_id: discordId }) => discordId);

const getProfiles = ({ limit = 10, page = 1 } = {}) => {
	if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(page) || page < 1) throw new Error('La pagination des personnages est invalide.');
	limit = Math.min(limit, 25);
	const db = getDatabase();
	const totalRows = db.prepare('SELECT COUNT(*) AS count FROM members').get().count;
	const rows = db.prepare(`
		SELECT discord_id, first_name, last_name, branch, branch_rank_id, division, division_rank_id, ira, status
		FROM members
		ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE, discord_id
		LIMIT ? OFFSET ?
	`).all(limit, (page - 1) * limit);
	return {
		rows: rows.map((profile) => ({
			discordId: profile.discord_id,
			firstName: profile.first_name,
			lastName: profile.last_name,
			branch: profile.branch,
			branchRankId: profile.branch_rank_id,
			division: profile.division,
			divisionRankId: profile.division_rank_id,
			ira: profile.ira,
			status: profile.status,
		})),
		totalRows,
		page,
		limit,
		totalPages: Math.max(1, Math.ceil(totalRows / limit)),
	};
};

const requireText = (value, label, maxLength = 100) => {
	if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} est obligatoire.`);
	if (value.trim().length > maxLength) throw new Error(`${label} ne peut pas dépasser ${maxLength} caractères.`);
	return value.trim();
};

const resolveProfileRank = ({ branch, division = null, rankId, branchRankId = null } = {}) => {
	if (!getLadder(branch).length) throw new Error('Branche invalide.');
	// BG et EIT peuvent avoir une division; les autres branches n'en ont pas.
	if (!['BG', 'EIT'].includes(branch) && division != null) throw new Error('Seules les branches BG et EIT peuvent avoir une division.');
	if (division != null && !['ULB', 'URR', 'UPR', 'UMS'].includes(division)) throw new Error('Division invalide.');

	if (division) {
		const ladder = getLadder('BG', division);
		const divisionRankId = rankId || ladder[0].id;
		if (!ladder.some((rank) => rank.id === divisionRankId)) throw new Error('Ce rang n’appartient pas à la division sélectionnée.');
		const mappedRankId = mapDivisionRankToBg(divisionRankId);
		// Pour EIT, le rang BG reste le rang EIT courant : on garde donc un branchRankId EIT existant, sinon le rang de base.
		if (branch === 'EIT') {
			const eitRankId = branchRankId ?? 'operateur-eit';
			if (!getLadder('EIT').some((rank) => rank.id === eitRankId)) throw new Error('Rang EIT invalide.');
			// L'IRA d'une division BG est basé sur le rang de division.
			return { branchRankId: eitRankId, division, divisionRankId, ira: computeIra({ branch: 'BG', division, divisionRankId, branchRankId: mappedRankId || 'agent-premiere-classe' }) };
		}
		if (!mappedRankId) throw new Error('Aucune correspondance BG n’est définie pour ce rang de division.');
		return { branchRankId: mappedRankId, division, divisionRankId, ira: computeIra({ branch, branchRankId: mappedRankId, division, divisionRankId }) };
	}

	const ladder = getLadder(branch);
	const resolvedBranchRankId = rankId || ladder[0].id;
	if (!ladder.some((rank) => rank.id === resolvedBranchRankId)) throw new Error('Ce rang n’appartient pas à la branche sélectionnée.');
	return { branchRankId: resolvedBranchRankId, division: null, divisionRankId: null, ira: computeIra({ branch, branchRankId: resolvedBranchRankId }) };
};

const getRankLimit = (branch, division, rankId) => {
	const limits = config.personnelRankLimits || {};
	const limit = division
		? limits.divisions?.[division]?.[rankId]
		: limits.branches?.[branch]?.[rankId];
	if (limit == null) return null;
	if (!Number.isInteger(limit) || limit < 1) throw new Error(`La limite configurée pour le rang ${rankId} doit être un entier positif.`);
	return limit;
};

const getRankOccupancy = (db, branch, division, rankId) => {
	const rankColumn = division ? 'division_rank_id' : 'branch_rank_id';
	const result = db.prepare(`
		SELECT COUNT(*) AS count
		FROM members
		WHERE branch = ? AND division IS ? AND ${rankColumn} = ? AND status = 'active'
	`).get(branch, division || null, rankId);
	return result.count;
};

const assertRankCapacity = (db, branch, division, rankId, excludingDiscordId = null) => {
	const limit = getRankLimit(branch, division, rankId);
	if (limit == null) return;
	const occupancy = getRankOccupancy(db, branch, division, rankId)
		- (excludingDiscordId && db.prepare(`
			SELECT COUNT(*) AS count FROM members
			WHERE discord_id = ? AND branch = ? AND division IS ? AND ${division ? 'division_rank_id' : 'branch_rank_id'} = ? AND status = 'active'
		`).get(excludingDiscordId, branch, division || null, rankId).count ? 1 : 0);
	if (occupancy >= limit) {
		const rank = getLadder(branch, division).find((entry) => entry.id === rankId);
		throw new Error(`Le rang « ${rank?.label || rankId} » est complet (${occupancy}/${limit} membres actifs).`);
	}
};

const getRankCounts = async (branch, division = null) => {
	const rankColumn = division ? 'division_rank_id' : 'branch_rank_id';
	const rows = getDatabase().prepare(`
		SELECT ${rankColumn} AS rankId, COUNT(*) AS count
		FROM members
		WHERE branch = ? AND division IS ? AND status = 'active'
		GROUP BY ${rankColumn}
	`).all(branch, division || null);
	return Object.fromEntries(rows.map(({ rankId, count }) => [rankId, count]));
};

const createProfile = async ({ discordId, firstName, lastName, branch, division = null, rankId } = {}) => {
	discordId = requireText(discordId, 'L’identifiant Discord', 30);
	firstName = requireText(firstName, 'Le prénom', 80);
	lastName = requireText(lastName, 'Le nom', 80);
	const rank = resolveProfileRank({ branch, division, rankId });
	try {
		const db = getDatabase();
		db.transaction(() => {
			assertRankCapacity(db, branch, division, division ? rank.divisionRankId : rank.branchRankId);
			db.prepare(`
			INSERT INTO members (discord_id, first_name, last_name, branch, branch_rank_id, division, division_rank_id, ira)
			VALUES (@discordId, @firstName, @lastName, @branch, @branchRankId, @division, @divisionRankId, @ira)
			`).run({ discordId, firstName, lastName, branch, ...rank });
		})();
	}
	catch (error) {
		if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new Error('Un profil existe déjà pour ce membre.', { cause: error });
		throw error;
	}
	return getProfile(discordId);
};

const updateInfo = async (discordId, { firstName, lastName, status } = {}) => {
	const updates = {};
	if (firstName !== undefined) updates.first_name = requireText(firstName, 'Le prénom', 80);
	if (lastName !== undefined) updates.last_name = requireText(lastName, 'Le nom', 80);
	if (status !== undefined) {
		if (!['active', 'inactive'].includes(status)) throw new Error('Statut invalide.');
		updates.status = status;
	}
	if (!Object.keys(updates).length) throw new Error('Aucune information à modifier.');
	const columns = Object.keys(updates);
	const db = getDatabase();
	db.transaction(() => {
		if (status === 'active') {
			const profile = db.prepare('SELECT branch, branch_rank_id, division, division_rank_id FROM members WHERE discord_id = ?').get(discordId);
			if (!profile) throw new Error('Aucun profil n’existe pour ce membre.');
			assertRankCapacity(db, profile.branch, profile.division, profile.division ? profile.division_rank_id : profile.branch_rank_id, discordId);
		}
		const result = db.prepare(`UPDATE members SET ${columns.map((column) => `${column} = @${column}`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE discord_id = @discordId`).run({ ...updates, discordId });
		if (!result.changes) throw new Error('Aucun profil n’existe pour ce membre.');
	})();
	return getProfile(discordId);
};

const deleteProfile = async (discordId) => {
	if (typeof discordId !== 'string' || !discordId.trim()) throw new Error('L’identifiant Discord est invalide.');
	const result = getDatabase().prepare('DELETE FROM members WHERE discord_id = ?').run(discordId);
	if (!result.changes) throw new Error('Aucun profil n’existe pour ce membre.');
	return result.changes > 0;
};

const setDivision = async (discordId, division, rankId, { branchRankId = null } = {}) => {
	const profile = await getProfile(discordId);
	if (!profile) throw new Error('Aucun profil n’existe pour ce membre.');
	if (!['BG', 'EIT'].includes(profile.branch)) throw new Error('La gestion de division est réservée aux branches BG et EIT.');
	if (division == null) {
		const ira = computeIra({ branch: profile.branch, branchRankId: profile.branchRankId });
		const db = getDatabase();
		db.transaction(() => {
			assertRankCapacity(db, profile.branch, null, profile.branchRankId, discordId);
			const result = db.prepare('UPDATE members SET division = NULL, division_rank_id = NULL, ira = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\') WHERE discord_id = ? AND branch = ? AND branch_rank_id = ? AND division IS ? AND division_rank_id IS ?').run(ira, discordId, profile.branch, profile.branchRankId, profile.division, profile.divisionRankId);
			if (!result.changes) throw new Error('Le profil a changé pendant la modification; recommencez.');
		})();
		return getProfile(discordId);
	}

	if (!['ULB', 'URR', 'UPR', 'UMS'].includes(division)) throw new Error('Division invalide.');
	const divisionRankId = rankId || getLadder('BG', division)[0].id;
	if (!getLadder('BG', division).some((rank) => rank.id === divisionRankId)) throw new Error('Ce rang n’appartient pas à la division sélectionnée.');
	// Pour un membre EIT, le rang de branche EIT est conservé; pour BG, celui de la division s'applique.
	const effectiveBranchRankId = profile.branch === 'EIT'
		? (branchRankId || profile.branchRankId)
		: mapDivisionRankToBg(divisionRankId);
	if (!effectiveBranchRankId) throw new Error('Aucune correspondance de rang n’est définie pour ce rang de division.');
	const ira = computeIra({ branch: 'BG', branchRankId: mapDivisionRankToBg(divisionRankId) || 'agent-premiere-classe', division, divisionRankId });
	const db = getDatabase();
	db.transaction(() => {
		assertRankCapacity(db, profile.branch, division, divisionRankId, discordId);
		const result = db.prepare(`
			UPDATE members
			SET branch_rank_id = ?, division = ?, division_rank_id = ?, ira = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE discord_id = ? AND branch = ? AND branch_rank_id = ? AND division IS ? AND division_rank_id IS ?
		`).run(effectiveBranchRankId, division, divisionRankId, ira, discordId, profile.branch, profile.branchRankId, profile.division, profile.divisionRankId);
		if (!result.changes) throw new Error('Le profil a changé pendant la modification; recommencez.');
	})();
	return getProfile(discordId);
};

const setBranch = async (discordId, branch, division = null, rankId = null) => {
	const profile = await getProfile(discordId);
	if (!profile) throw new Error('Aucun profil n’existe pour ce membre.');
	const rank = resolveProfileRank({ branch, division, rankId });
	const db = getDatabase();
	db.transaction(() => {
		assertRankCapacity(db, branch, rank.division, rank.division ? rank.divisionRankId : rank.branchRankId, discordId);
		const result = db.prepare(`
			UPDATE members
			SET branch = ?, branch_rank_id = ?, division = ?, division_rank_id = ?, ira = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE discord_id = ? AND branch = ? AND branch_rank_id = ? AND division IS ? AND division_rank_id IS ? AND ira = ?
		`).run(
			branch,
			rank.branchRankId,
			rank.division,
			rank.divisionRankId,
			rank.ira,
			discordId,
			profile.branch,
			profile.branchRankId,
			profile.division,
			profile.divisionRankId,
			profile.ira,
		);
		if (!result.changes) throw new Error('Le profil a changé pendant la modification; recommencez.');
	})();
	return getProfile(discordId);
};

const validateActivityMetadata = ({ source, reason, actorId } = {}) => ({
	source: requireText(source, 'La source', 100),
	reason: requireText(reason, 'Le motif', 500),
	actorId: requireText(actorId, 'L’identifiant de l’auteur', 30),
});

const applyActivity = async (client, discordId, type, amount, metadata) => {
	if (!['points', 'hours'].includes(type)) throw new Error('Type d’activité invalide.');
	if (typeof discordId !== 'string' || !discordId.trim()) throw new Error('L’identifiant Discord est invalide.');
	if (!Number.isFinite(amount) || amount === 0) throw new Error('Le montant doit être un nombre fini non nul.');
	const storedAmount = type === 'hours' ? Math.round(amount * 60) : amount;
	if (!storedAmount) throw new Error('La durée doit correspondre à au moins une minute.');
	const activityMetadata = validateActivityMetadata(metadata);
	const db = getDatabase();
	const operation = db.transaction(() => {
		const profile = db.prepare('SELECT discord_id FROM members WHERE discord_id = ?').get(discordId);
		if (!profile) return false;
		const memberColumn = type === 'points' ? 'activity_points' : 'activity_minutes';
		db.prepare(`UPDATE members SET ${memberColumn} = ${memberColumn} + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE discord_id = ?`).run(storedAmount, discordId);
		db.prepare('INSERT INTO activity_logs (discord_id, type, amount, source, reason, actor_id) VALUES (?, ?, ?, ?, ?, ?)')
			.run(discordId, type, storedAmount, activityMetadata.source, activityMetadata.reason, activityMetadata.actorId);
		return true;
	});
	if (!operation()) {
		await client.log('PERSONNEL', 'WARN', `Activité ${type} ignorée : aucun profil pour <@${discordId}>.`);
		return { ok: false, reason: 'NO_PROFILE' };
	}
	return { ok: true, amount: storedAmount };
};

const addActivityPoints = async (client, discordId, amount, metadata) => {
	if (!Number.isFinite(amount) || amount <= 0) throw new Error('Le nombre de points doit être positif.');
	return applyActivity(client, discordId, 'points', amount, metadata);
};

const addActivityHours = async (client, discordId, hours, metadata) => {
	if (!Number.isFinite(hours) || hours <= 0) throw new Error('Le nombre d’heures doit être positif.');
	return applyActivity(client, discordId, 'hours', hours, metadata);
};

const removeActivity = async (client, discordId, { type, amount, source, reason, actorId } = {}) => {
	if (!Number.isFinite(amount) || amount >= 0) throw new Error('Une correction doit utiliser un montant négatif.');
	return applyActivity(client, discordId, type, amount, { source, reason, actorId });
};

const getLeaderboard = async ({ type, period = 'all', limit = 10, page = 1 } = {}) => {
	if (!['points', 'hours'].includes(type)) throw new Error('Type de classement invalide.');
	if (!['all', 'week', 'month'].includes(period)) throw new Error('Période de classement invalide.');
	if (!Number.isInteger(limit) || limit < 1) throw new Error('La limite doit être un entier positif.');
	if (!Number.isInteger(page) || page < 1) throw new Error('La page doit être un entier positif.');
	limit = Math.min(limit, 25);
	const offset = (page - 1) * limit;
	const db = getDatabase();
	const totalRows = db.prepare('SELECT COUNT(*) AS count FROM members WHERE status = \'active\'').get().count;
	let rows;
	if (period === 'all') {
		const column = type === 'points' ? 'activity_points' : 'activity_minutes';
		rows = db.prepare(`SELECT discord_id, first_name, last_name, ${column} AS amount FROM members WHERE status = 'active' ORDER BY amount DESC, last_name COLLATE NOCASE, first_name COLLATE NOCASE, discord_id LIMIT ? OFFSET ?`).all(limit, offset);
	}
	else {
		const windowMs = period === 'week' ? 7 * 24 * 60 * 60_000 : 30 * 24 * 60 * 60_000;
		const since = new Date(Date.now() - windowMs).toISOString();
		rows = db.prepare(`
			SELECT m.discord_id, m.first_name, m.last_name, COALESCE(SUM(a.amount), 0) AS amount
			FROM members AS m
			LEFT JOIN activity_logs AS a ON a.discord_id = m.discord_id AND a.type = ? AND a.created_at >= ?
			WHERE m.status = 'active'
			GROUP BY m.discord_id
			ORDER BY amount DESC, m.last_name COLLATE NOCASE, m.first_name COLLATE NOCASE, m.discord_id
			LIMIT ? OFFSET ?
		`).all(type, since, limit, offset);
	}
	return {
		rows: rows.map((row) => ({
			discordId: row.discord_id,
			firstName: row.first_name,
			lastName: row.last_name,
			amount: type === 'hours' ? row.amount / 60 : row.amount,
		})),
		totalRows,
		page,
		limit,
		totalPages: Math.max(1, Math.ceil(totalRows / limit)),
	};
};

const getActiveSanctionCount = async (discordId) => getDatabase()
	.prepare('SELECT COUNT(*) AS count FROM sanctions WHERE discord_id = ? AND revoked_at IS NULL')
	.get(discordId).count;

const addSanction = async (discordId, type, reason, issuerId) => {
	type = requireText(type, 'Le type de sanction', 100);
	if (!Array.isArray(config.sanctionTypes) || !config.sanctionTypes.includes(type)) throw new Error('Type de sanction non autorisé.');
	reason = requireText(reason, 'Le motif', 1000);
	issuerId = requireText(issuerId, 'L’identifiant de l’émetteur', 30);
	const db = getDatabase();
	const allocate = db.transaction(() => {
		if (!db.prepare('SELECT 1 FROM members WHERE discord_id = ?').get(discordId)) throw new Error('Aucun profil n’existe pour ce membre.');
		const counter = db.prepare('INSERT INTO counters (name, value) VALUES (\'sanction_case\', 1) ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value').get();
		const caseNumber = counter.value;
		db.prepare('INSERT INTO sanctions (case_number, discord_id, type, reason, issuer_id) VALUES (?, ?, ?, ?, ?)').run(caseNumber, discordId, type, reason, issuerId);
		return caseNumber;
	});
	const caseNumber = allocate();
	return getDatabase().prepare('SELECT * FROM sanctions WHERE case_number = ?').get(caseNumber);
};

const getSanctions = async (discordId, { includeRevoked = false, limit = 10, page = 1 } = {}) => {
	if (typeof discordId !== 'string' || !discordId.trim()) throw new Error('L’identifiant Discord est invalide.');
	if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(page) || page < 1) throw new Error('La pagination est invalide.');
	limit = Math.min(limit, 25);
	const filter = includeRevoked ? '' : ' AND revoked_at IS NULL';
	const db = getDatabase();
	const totalRows = db.prepare(`SELECT COUNT(*) AS count FROM sanctions WHERE discord_id = ?${filter}`).get(discordId).count;
	const rows = db.prepare(`SELECT * FROM sanctions WHERE discord_id = ?${filter} ORDER BY case_number DESC LIMIT ? OFFSET ?`).all(discordId, limit, (page - 1) * limit);
	return { rows, totalRows, page, limit, totalPages: Math.max(1, Math.ceil(totalRows / limit)) };
};

const revokeSanction = async (caseNumber, revokerId, reason) => {
	if (!Number.isInteger(caseNumber) || caseNumber < 1) throw new Error('Numéro de dossier invalide.');
	revokerId = requireText(revokerId, 'L’identifiant du responsable', 30);
	reason = requireText(reason, 'Le motif de révocation', 1000);
	const result = getDatabase().prepare('UPDATE sanctions SET revoked_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\'), revoked_by = ?, revoke_reason = ? WHERE case_number = ? AND revoked_at IS NULL').run(revokerId, reason, caseNumber);
	if (!result.changes) throw new Error('Dossier introuvable ou déjà révoqué.');
	return getDatabase().prepare('SELECT * FROM sanctions WHERE case_number = ?').get(caseNumber);
};

const rankLabel = (rankId) => getRank(rankId)?.label || rankId;

const buildPromotion = (profile, targetRankId) => {
	if (profile.branch === 'COMMANDEMENT') return { ok: false, reason: 'Le COMMANDEMENT ne peut pas être promu par ce flux.' };
	const ladder = getLadder(profile.branch, profile.division);
	const fromRankId = profile.division ? profile.divisionRankId : profile.branchRankId;
	const nextRank = getNextRank(ladder, fromRankId);
	if (!nextRank) return { ok: false, reason: 'Le membre est déjà au sommet de son échelle.' };
	if (targetRankId && targetRankId !== nextRank.id) return { ok: false, reason: 'La promotion doit viser le rang immédiatement supérieur.' };
	const nextRankLimit = getRankLimit(profile.branch, profile.division, nextRank.id);
	if (nextRankLimit != null && getRankOccupancy(getDatabase(), profile.branch, profile.division, nextRank.id) >= nextRankLimit) {
		return { ok: false, reason: `Le rang « ${nextRank.label} » est complet (${getRankOccupancy(getDatabase(), profile.branch, profile.division, nextRank.id)}/${nextRankLimit} membres actifs).` };
	}
	const nextBranchRankId = profile.division ? mapDivisionRankToBg(nextRank.id) : nextRank.id;
	if (!nextBranchRankId) return { ok: false, reason: 'Aucune correspondance BG n’est définie pour le rang suivant.' };
	const ira = computeIra({
		branch: profile.branch,
		branchRankId: nextBranchRankId,
		division: profile.division,
		divisionRankId: profile.division ? nextRank.id : null,
	});
	return {
		ok: true,
		from: {
			branchRankId: profile.branchRankId,
			divisionRankId: profile.divisionRankId,
			label: profile.division ? rankLabel(profile.divisionRankId) : rankLabel(profile.branchRankId),
			ira: profile.ira,
		},
		to: {
			branchRankId: nextBranchRankId,
			divisionRankId: profile.division ? nextRank.id : null,
			label: nextRank.label,
			ira,
		},
		iraChanged: ira !== profile.ira,
		branch: profile.branch,
		division: profile.division,
	};
};

const previewPromotion = async (discordId, targetRankId) => {
	const profile = await getProfile(discordId);
	if (!profile) return { ok: false, reason: 'Aucun profil n’existe pour ce membre.' };
	return buildPromotion(profile, targetRankId);
};

const applyPromotions = async (client, issuerId, candidates, note = '') => {
	if (!Array.isArray(candidates)) throw new Error('La liste des promotions est invalide.');
	issuerId = requireText(issuerId, 'L’identifiant de l’émetteur', 30);
	const successes = [];
	const failures = [];
	const seen = new Set();
	for (const candidate of candidates) {
		const discordId = candidate?.discordId;
		if (typeof discordId !== 'string' || !discordId.trim()) {
			failures.push({ discordId: String(discordId || ''), reason: 'Identifiant Discord invalide.' });
			continue;
		}
		if (seen.has(discordId)) {
			failures.push({ discordId, reason: 'Membre sélectionné plusieurs fois.' });
			continue;
		}
		seen.add(discordId);
		try {
			const profile = await getProfile(discordId);
			if (!profile) {
				failures.push({ discordId, reason: 'Aucun profil n’existe pour ce membre.' });
				continue;
			}
			const promotion = buildPromotion(profile, candidate.targetRankId);
			if (!promotion.ok) {
				failures.push({ discordId, reason: promotion.reason });
				continue;
			}
			const db = getDatabase();
			const result = db.transaction(() => {
				const targetRankId = profile.division ? promotion.to.divisionRankId : promotion.to.branchRankId;
				assertRankCapacity(db, profile.branch, profile.division, targetRankId, discordId);
				return db.prepare(`
					UPDATE members
					SET branch_rank_id = ?, division_rank_id = ?, ira = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
					WHERE discord_id = ? AND branch = ? AND branch_rank_id = ? AND division IS ? AND division_rank_id IS ? AND ira = ?
				`).run(
					promotion.to.branchRankId,
					promotion.to.divisionRankId,
					promotion.to.ira,
					discordId,
					profile.branch,
					profile.branchRankId,
					profile.division,
					profile.divisionRankId,
					profile.ira,
				);
			})();
			if (!result.changes) {
				failures.push({ discordId, reason: 'Le rang a changé pendant la vague; aucune promotion appliquée.' });
				continue;
			}
			successes.push({
				discordId,
				from: promotion.from,
				to: promotion.to,
				iraChanged: promotion.iraChanged,
				branch: profile.branch,
				division: profile.division,
			});
		}
		catch (error) {
			failures.push({ discordId, reason: error.message });
		}
	}
	const changes = successes.map(({ discordId, from, to, iraChanged }) => `${discordId}: ${from.label} -> ${to.label}${iraChanged ? ` (IRA ${from.ira} -> ${to.ira})` : ''}`).join('; ') || 'aucun';
	await client.log('PERSONNEL', 'INFO', `Vague de promotions par ${issuerId}; note : ${String(note).slice(0, 500) || 'aucune'}; changements : ${changes}.`);
	return { succès: successes, échecs: failures };
};

const setRank = async (discordId, rankId) => {
	const profile = await getProfile(discordId);
	if (!profile) throw new Error('Aucun profil n’existe pour ce membre.');
	const rank = getLadder(profile.branch, profile.division).find((entry) => entry.id === rankId);
	if (!rank) throw new Error('Ce rang n’appartient pas à la branche ou division du membre.');
	const branchRankId = profile.division ? mapDivisionRankToBg(rankId) : rankId;
	if (!branchRankId) throw new Error('Aucune correspondance BG n’est définie pour ce rang.');
	const divisionRankId = profile.division ? rankId : null;
	const ira = computeIra({ branch: profile.branch, branchRankId, division: profile.division, divisionRankId });
	const db = getDatabase();
	db.transaction(() => {
		assertRankCapacity(db, profile.branch, profile.division, rankId, discordId);
		const result = db.prepare(`
			UPDATE members SET branch_rank_id = ?, division_rank_id = ?, ira = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE discord_id = ? AND branch_rank_id = ? AND division IS ? AND division_rank_id IS ?
		`).run(branchRankId, divisionRankId, ira, discordId, profile.branchRankId, profile.division, profile.divisionRankId);
		if (!result.changes) throw new Error('Le rang a changé pendant la modification; recommencez.');
	})();
	return getProfile(discordId);
};

const demoteMember = async (discordId) => {
	const profile = await getProfile(discordId);
	if (!profile) throw new Error('Aucun profil n’existe pour ce membre.');
	const ladder = getLadder(profile.branch, profile.division);
	const currentRankId = profile.division ? profile.divisionRankId : profile.branchRankId;
	const currentIndex = ladder.findIndex((rank) => rank.id === currentRankId);
	if (currentIndex <= 0) throw new Error('Le membre est déjà au plus bas de son échelle.');
	const previousRank = ladder[currentIndex - 1];
	const branchRankId = profile.division ? mapDivisionRankToBg(previousRank.id) : previousRank.id;
	const divisionRankId = profile.division ? previousRank.id : null;
	const ira = computeIra({ branch: profile.branch, branchRankId, division: profile.division, divisionRankId });
	const db = getDatabase();
	db.transaction(() => {
		assertRankCapacity(db, profile.branch, profile.division, previousRank.id, discordId);
		const result = db.prepare(`
			UPDATE members SET branch_rank_id = ?, division_rank_id = ?, ira = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE discord_id = ? AND branch_rank_id = ? AND division IS ? AND division_rank_id IS ?
		`).run(branchRankId, divisionRankId, ira, discordId, profile.branchRankId, profile.division, profile.divisionRankId);
		if (!result.changes) throw new Error('Le rang a changé pendant la rétrogradation; recommencez.');
	})();
	return { from: currentRankId, to: previousRank.id, iraChanged: ira !== profile.ira, profile: await getProfile(discordId) };
};

module.exports = {
	setDatabase,
	getProfile,
	hasProfile,
	getProfileDiscordIds,
	getProfiles,
	getRankLimit,
	getRankCounts,
	createProfile,
	updateInfo,
	deleteProfile,
	setDivision,
	setBranch,
	addActivityPoints,
	addActivityHours,
	removeActivity,
	getLeaderboard,
	getActiveSanctionCount,
	addSanction,
	getSanctions,
	revokeSanction,
	previewPromotion,
	applyPromotions,
	setRank,
	demoteMember,
};