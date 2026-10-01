const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { openDatabase } = require('../framework_utils/Database.js');

let temporaryDirectory;

test.beforeEach(() => {
	temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'botsecu-database-'));
});

test.afterEach(() => {
	fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('database migration preserves existing personnel records and accepts Direction and Commission', () => {
	const databasePath = path.join(temporaryDirectory, 'personnel.sqlite');
	const legacyDatabase = new Database(databasePath);
	legacyDatabase.exec(`
		CREATE TABLE members (
			discord_id TEXT PRIMARY KEY,
			first_name TEXT NOT NULL,
			last_name TEXT NOT NULL,
			branch TEXT NOT NULL CHECK (branch IN ('EIT', 'BG', 'COMMANDEMENT')),
			branch_rank_id TEXT NOT NULL,
			division TEXT CHECK (division IS NULL OR division IN ('ULB', 'URR', 'UPR', 'UMS')),
			division_rank_id TEXT,
			ira INTEGER NOT NULL CHECK (ira BETWEEN 1 AND 7),
			activity_points REAL NOT NULL DEFAULT 0,
			activity_minutes INTEGER NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
			created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
			updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
			CHECK ((division IS NULL AND division_rank_id IS NULL) OR (branch = 'BG' AND division IS NOT NULL AND division_rank_id IS NOT NULL))
		);
		CREATE TABLE activity_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			discord_id TEXT NOT NULL REFERENCES members(discord_id) ON DELETE CASCADE,
			type TEXT NOT NULL CHECK (type IN ('points', 'hours')),
			amount REAL NOT NULL,
			source TEXT NOT NULL,
			reason TEXT NOT NULL,
			actor_id TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
		);
		CREATE TABLE sanctions (
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
		INSERT INTO members (discord_id, first_name, last_name, branch, branch_rank_id, ira, activity_points, activity_minutes)
		VALUES ('legacy-member', 'Jean', 'Test', 'BG', 'agent-securite', 1, 12, 90);
		INSERT INTO activity_logs (discord_id, type, amount, source, reason, actor_id)
		VALUES ('legacy-member', 'points', 12, 'test', 'historique', 'staff');
		INSERT INTO sanctions (case_number, discord_id, type, reason, issuer_id)
		VALUES (1, 'legacy-member', 'Avertissement', 'historique', 'staff');
	`);
	legacyDatabase.close();

	const database = openDatabase(databasePath);
	try {
		const member = database.prepare('SELECT * FROM members WHERE discord_id = ?').get('legacy-member');
		assert.equal(member.activity_points, 12);
		assert.equal(member.activity_minutes, 90);
		assert.equal(database.prepare('SELECT COUNT(*) AS count FROM activity_logs WHERE discord_id = ?').get('legacy-member').count, 1);
		assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sanctions WHERE discord_id = ?').get('legacy-member').count, 1);
		assert.deepEqual(database.pragma('foreign_key_check'), []);
		database.prepare(`
			INSERT INTO members (discord_id, first_name, last_name, branch, branch_rank_id, ira)
			VALUES ('commission-member', 'Camille', 'Sureté', 'COMMISSION', 'officier-commission', 6)
		`).run();
		assert.equal(database.prepare('SELECT branch FROM members WHERE discord_id = ?').get('commission-member').branch, 'COMMISSION');
	}
	finally {
		database.close();
	}
});

test('database startup upgrades Commission profiles using the removed representative rank', () => {
	const databasePath = path.join(temporaryDirectory, 'commission.sqlite');
	const legacyDatabase = new Database(databasePath);
	legacyDatabase.exec(`
		CREATE TABLE members (
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
			CHECK ((division IS NULL AND division_rank_id IS NULL) OR (branch = 'BG' AND division IS NOT NULL AND division_rank_id IS NOT NULL))
		);
		INSERT INTO members (discord_id, first_name, last_name, branch, branch_rank_id, ira)
		VALUES ('legacy-representative', 'Alex', 'Département', 'COMMISSION', 'representant-departement', 5);
	`);
	legacyDatabase.close();

	const database = openDatabase(databasePath);
	try {
		const member = database.prepare('SELECT branch_rank_id, ira FROM members WHERE discord_id = ?').get('legacy-representative');
		assert.deepEqual(member, { branch_rank_id: 'officier-commission', ira: 6 });
	}
	finally {
		database.close();
	}
});
