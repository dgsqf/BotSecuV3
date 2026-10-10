const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const DEFAULT_DATABASE_PATH = path.join(__dirname, '..', 'data', 'personnel.sqlite');

const createMembersTable = (tableName, ifNotExists = false) => `
	CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${tableName} (
		discord_id TEXT PRIMARY KEY,
		first_name TEXT NOT NULL,
		last_name TEXT NOT NULL,
		branch TEXT NOT NULL CHECK (branch IN ('EIT', 'BG', 'COMMANDEMENT', 'DIRECTION', 'COMMISSION')),
		branch_rank_id TEXT NOT NULL,
		division TEXT CHECK (division IS NULL OR division IN ('ULB', 'URR', 'UPR', 'UMS')),
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
	if (memberSchema.includes('\'DIRECTION\'') && memberSchema.includes('\'COMMISSION\'') && memberSchema.includes('BETWEEN 1 AND 8')) {
		migrateRemovedCommissionRank();
		return;
	}

	database.pragma('foreign_keys = OFF');
	try {
		database.transaction(() => {
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