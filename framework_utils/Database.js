const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { getRank, mapDivisionRankToBg } = require('../data/hierarchy.js');

const DEFAULT_DATABASE_PATH = path.join(__dirname, '..', 'data', 'personnel.sqlite');

// Divisions reconnues par le schéma et par la gestion du personnel.
const DIVISIONS = ['ULB', 'URR', 'UPR'];
const DIVISION_SQL_LIST = DIVISIONS.map((division) => `'${division}'`).join(', ');

const createMembersTable = (tableName, ifNotExists = false) => `
	CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${tableName} (
		discord_id TEXT PRIMARY KEY,
		first_name TEXT NOT NULL,
		last_name TEXT NOT NULL,
		branch TEXT NOT NULL CHECK (branch IN ('EIT', 'BG', 'COMMANDEMENT', 'DIRECTION', 'COMMISSION')),
		branch_rank_id TEXT NOT NULL,
		division TEXT CHECK (division IS NULL OR division IN (${DIVISION_SQL_LIST})),
		division_rank_id TEXT,
		ira INTEGER NOT NULL CHECK (ira BETWEEN 1 AND 8),
		activity_points REAL NOT NULL DEFAULT 0,
		activity_minutes INTEGER NOT NULL DEFAULT 0,
		status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
		updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
		CHECK ((division IS NULL AND division_rank_id IS NULL) OR (branch IN ('BG', 'EIT') AND division IS NOT NULL AND division_rank_id IS NOT NULL))
	);
`;

const SCHEMA = `
	${createMembersTable('members', true)}

	CREATE TABLE IF NOT EXISTS activity_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		discord_id TEXT NOT NULL REFERENCES members(discord_id) ON DELETE CASCADE,
		type TEXT NOT NULL CHECK (type IN ('points', 'hours')),
		amount REAL NOT NULL,
		source TEXT NOT NULL,
		reason TEXT NOT NULL,
		actor_id TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
	);

	CREATE TABLE IF NOT EXISTS counters (
		name TEXT PRIMARY KEY,
		value INTEGER NOT NULL CHECK (value >= 0)
	);

	CREATE TABLE IF NOT EXISTS sanctions (
		case_number INTEGER PRIMARY KEY,
		discord_id TEXT NOT NULL REFERENCES members(discord_id) ON DELETE CASCADE,
		type TEXT NOT NULL,
		reason TEXT NOT NULL,
		issuer_id TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
		revoked_at TEXT,
		revoked_by TEXT,
		revoke_reason TEXT
	);

	CREATE INDEX IF NOT EXISTS idx_activity_logs_discord_id ON activity_logs(discord_id);
	CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);
	CREATE INDEX IF NOT EXISTS idx_activity_logs_period ON activity_logs(type, created_at, discord_id);
	CREATE INDEX IF NOT EXISTS idx_sanctions_discord_id ON sanctions(discord_id);
	CREATE INDEX IF NOT EXISTS idx_sanctions_created_at ON sanctions(created_at);
`;

const migrateMemberBranchSchema = (database) => {
	const memberSchema = database.prepare('SELECT sql FROM sqlite_master WHERE type = \'table\' AND name = \'members\'').get()?.sql || '';
	const migrateRemovedCommissionRank = () => database.prepare(`
		UPDATE members SET branch_rank_id = 'officier-commission', ira = 6
		WHERE branch = 'COMMISSION' AND branch_rank_id = 'representant-departement'
	`).run();
	// Une division retirée de la configuration ne doit pas empêcher le démarrage : ses profils
	// réintègrent leur branche avec le rang BG équivalent à leur ancien titre de division.
	const migrateRetiredDivisions = () => {
		const retired = database.prepare(`
			SELECT discord_id, branch, division_rank_id FROM members
			WHERE division IS NOT NULL AND division NOT IN (${DIVISION_SQL_LIST})
		`).all();
		const updateBgMember = database.prepare('UPDATE members SET branch_rank_id = ?, division = NULL, division_rank_id = NULL, ira = ? WHERE discord_id = ?');
		const releaseDivision = database.prepare('UPDATE members SET division = NULL, division_rank_id = NULL WHERE discord_id = ?');
		for (const member of retired) {
			if (member.branch !== 'BG') {
				releaseDivision.run(member.discord_id);
				continue;
			}
			const branchRankId = mapDivisionRankToBg(member.division_rank_id) || 'agent-securite';
			updateBgMember.run(branchRankId, getRank(branchRankId)?.ira ?? 1, member.discord_id);
		}
	};
	if (memberSchema.includes('\'DIRECTION\'') && memberSchema.includes('\'COMMISSION\'') && memberSchema.includes('BETWEEN 1 AND 8') && memberSchema.includes(`division IN (${DIVISION_SQL_LIST})`)) {
		migrateRemovedCommissionRank();
		return;
	}

	database.pragma('foreign_keys = OFF');
	try {
		database.transaction(() => {
			migrateRetiredDivisions();
			database.exec(createMembersTable('members_new'));
			database.exec(`
				INSERT INTO members_new (
					discord_id, first_name, last_name, branch, branch_rank_id, division,
					division_rank_id, ira, activity_points, activity_minutes, status, created_at, updated_at
				)
				SELECT discord_id, first_name, last_name, branch, branch_rank_id, division,
					division_rank_id, ira, activity_points, activity_minutes, status, created_at, updated_at
				FROM members
			`);
			database.exec('DROP TABLE members; ALTER TABLE members_new RENAME TO members;');
		})();
		migrateRemovedCommissionRank();
	}
	finally {
		database.pragma('foreign_keys = ON');
	}
};

const openDatabase = (filePath = process.env.SQLITE_PATH || DEFAULT_DATABASE_PATH) => {
	const resolvedPath = filePath === ':memory:' ? filePath : path.resolve(filePath);
	if (resolvedPath !== ':memory:') fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

	let database;
	try {
		database = new Database(resolvedPath);
		database.pragma('foreign_keys = ON');
		database.pragma('journal_mode = WAL');
		database.pragma('busy_timeout = 5000');
		database.exec(SCHEMA);
		migrateMemberBranchSchema(database);
		return database;
	}
	catch (error) {
		database?.close();
		throw error;
	}
};

module.exports = { openDatabase, DEFAULT_DATABASE_PATH };