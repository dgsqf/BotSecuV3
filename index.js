
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const {
	Client,
	Collection,
	GatewayIntentBits,
	Partials,
} = require('discord.js');

const {
	logChannelId: configuredLogChannelId,
} = require('./config.json');

const {
	createLogger,
} = require('./framework_utils/Logging.js');

const {
	openDatabase,
} = require('./framework_utils/Database.js');

const personnel = require('./framework_utils/Personnel.js');


// ============================================================
// DÉMARRAGE
// ============================================================

console.log('Starting bot...');


// ============================================================
// VÉRIFICATION DU TOKEN
// ============================================================

if (!process.env.DISCORD_BOT_TOKEN) {
	console.error(
		'[FATAL] DISCORD_BOT_TOKEN is not defined.',
	);

	process.exitCode = 1;
	return;
}


// ============================================================
// CLIENT DISCORD
// ============================================================

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.GuildMessageReactions,
	],

	partials: [
		Partials.Message,
		Partials.Channel,
		Partials.Reaction,
	],
});


// ============================================================
// PROPRIÉTÉS DU CLIENT
// ============================================================

client.log = createLogger(
	client,
	process.env.LOG_CHANNEL_ID || configuredLogChannelId,
);

client.database = null;
client.statusMessage = null;
client.eventTrackingInterval = null;

client.commands = new Collection();
client.cooldowns = new Collection();
client.cooldownLogs = new Set();


// ============================================================
// TERMINAL
// ============================================================

const terminal = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
	prompt: '> ',
});


// ============================================================
// CHARGEMENT DES COMMANDES
// ============================================================

const foldersPath = path.join(__dirname, 'commands');

if (!fs.existsSync(foldersPath)) {
	console.warn(
		'[WARNING] Commands directory does not exist.',
	);
}
else {
	const commandFolders = fs
		.readdirSync(foldersPath, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);

	for (const folder of commandFolders) {
		const commandsPath = path.join(foldersPath, folder);

		const commandFiles = fs
			.readdirSync(commandsPath)
			.filter((file) => file.endsWith('.js'));

		for (const file of commandFiles) {
			const filePath = path.join(commandsPath, file);

			try {
				const command = require(filePath);

				if (
					'data' in command &&
					'execute' in command
				) {
					client.commands.set(
						command.data.name,
						command,
					);

					console.log(
						`Command ${command.data.name} loaded successfully.`,
					);
				}
				else {
					console.warn(
						`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`,
					);
				}
			}
			catch (error) {
				console.error(
					`[ERROR] Impossible de charger la commande ${filePath}:`,
					error,
				);
			}
		}
	}
}


// ============================================================
// CHARGEMENT DES ÉVÉNEMENTS
// ============================================================

const eventsPath = path.join(__dirname, 'events');

if (!fs.existsSync(eventsPath)) {
	console.warn(
		'[WARNING] Events directory does not exist.',
	);
}
else {
	const eventFiles = fs
		.readdirSync(eventsPath)
		.filter((file) => file.endsWith('.js'));

	for (const file of eventFiles) {
		const filePath = path.join(eventsPath, file);

		try {
			const event = require(filePath);

			if (
				!event.name ||
				typeof event.execute !== 'function'
			) {
				console.warn(
					`[WARNING] Invalid event file: ${filePath}`,
				);

				continue;
			}

			if (event.once) {
				client.once(
					event.name,
					(...args) => {
						try {
							const result = event.execute(...args);

							if (result instanceof Promise) {
								result.catch((error) => {
									console.error(
										`[ERROR] Event ${event.name}:`,
										error,
									);
								});
							}
						}
						catch (error) {
							console.error(
								`[ERROR] Event ${event.name}:`,
								error,
							);
						}
					},
				);
			}
			else {
				client.on(
					event.name,
					(...args) => {
						try {
							const result = event.execute(...args);

							if (result instanceof Promise) {
								result.catch((error) => {
									console.error(
										`[ERROR] Event ${event.name}:`,
										error,
									);
								});
							}
						}
						catch (error) {
							console.error(
								`[ERROR] Event ${event.name}:`,
								error,
							);
						}
					},
				);
			}

			console.log(
				`Event ${event.name} loaded successfully.`,
			);
		}
		catch (error) {
			console.error(
				`[ERROR] Impossible de charger l'événement ${filePath}:`,
				error,
			);
		}
	}
}


// ============================================================
// ÉTAT DU SHUTDOWN
// ============================================================

let shuttingDown = false;


// ============================================================
// FERMETURE DE LA BASE DE DONNÉES
// ============================================================

const closeDatabase = () => {
	if (!client.database) {
		return;
	}

	try {
		console.log('[SHUTDOWN] Closing SQLite database...');

		client.database.close();

		client.database = null;

		console.log('[SHUTDOWN] SQLite database closed.');
	}
	catch (error) {
		console.error(
			'[SHUTDOWN] Error while closing SQLite:',
			error,
		);
	}
};


// ============================================================
// SHUTDOWN PROPRE
// ============================================================

const shutdown = async (reason = 'terminal') => {
	if (shuttingDown) {
		console.log(
			'[SHUTDOWN] Shutdown already in progress.',
		);

		return;
	}

	shuttingDown = true;

	console.log('');
	console.log('========================================');
	console.log(
		`[SHUTDOWN] Shutdown requested: ${reason}`,
	);
	console.log('========================================');


	// ----------------------------------------------------------
	// 1. ARRÊT DES INTERVALLES
	// ----------------------------------------------------------

	console.log('[SHUTDOWN] Stopping intervals...');

	if (client.eventTrackingInterval) {
		clearInterval(client.eventTrackingInterval);

		client.eventTrackingInterval = null;

		console.log(
			'[SHUTDOWN] Event tracking interval stopped.',
		);
	}
	else {
		console.log(
			'[SHUTDOWN] No event tracking interval.',
		);
	}


	// ----------------------------------------------------------
	// 2. MISE À JOUR DU MESSAGE DISCORD
	// ----------------------------------------------------------

	console.log(
		'[SHUTDOWN] Updating Discord status message...',
	);

	if (client.statusMessage) {
		try {
			console.log(
				`[SHUTDOWN] Status message ID: ${client.statusMessage.id}`,
			);

			await client.statusMessage.edit({
				embeds: [{
					title: 'Statut du C.S.A',
					description: '🔴 C.S.A Éteint',
					color: 0xff0000,
					timestamp: new Date().toISOString(),
				}],
			});

			console.log(
				'[SHUTDOWN] Discord status message updated successfully.',
			);
		}
		catch (error) {
			console.error(
				'[SHUTDOWN] Failed to update Discord status message:',
				error,
			);
		}
	}
	else {
		console.warn(
			'[SHUTDOWN] client.statusMessage is null.',
		);
	}


	// ----------------------------------------------------------
	// 3. FERMETURE SQLITE
	// ----------------------------------------------------------

	closeDatabase();


	// ----------------------------------------------------------
	// 4. DÉCONNEXION DISCORD
	// ----------------------------------------------------------

	console.log(
		'[SHUTDOWN] Disconnecting Discord client...',
	);

	try {
		client.destroy();

		console.log(
			'[SHUTDOWN] Discord client disconnected.',
		);
	}
	catch (error) {
		console.error(
			'[SHUTDOWN] Failed to disconnect Discord client:',
			error,
		);
	}


	// ----------------------------------------------------------
	// 5. TERMINAL
	// ----------------------------------------------------------

	console.log('[SHUTDOWN] Closing terminal interface...');

	terminal.close();


	// ----------------------------------------------------------
	// FIN
	// ----------------------------------------------------------

	console.log('');
	console.log('========================================');
	console.log('[SHUTDOWN] Bot stopped successfully.');
	console.log('========================================');
	console.log('');
};


// ============================================================
// COMMANDES TERMINAL
// ============================================================

terminal.on('line', async (input) => {
	const command = input
		.trim()
		.toLowerCase();

	if (!command) {
		if (!shuttingDown) {
			terminal.prompt();
		}

		return;
	}


	// ----------------------------------------------------------
	// STOP
	// ----------------------------------------------------------

	if (
		command === 'stop' ||
		command === 'shutdown' ||
		command === 'quit'
	) {
		await shutdown('terminal');

		return;
	}


	// ----------------------------------------------------------
	// STATUS
	// ----------------------------------------------------------

	if (command === 'status') {
		console.log('');

		if (client.isReady()) {
			console.log('🟢 Discord: Connected');
		}
		else {
			console.log('🔴 Discord: Disconnected');
		}

		console.log(
			client.statusMessage
				? `🟢 Status message: ${client.statusMessage.id}`
				: '🔴 Status message: not available',
		);

		console.log(
			client.database
				? '🟢 SQLite: Connected'
				: '🔴 SQLite: Closed',
		);

		console.log('');

		if (!shuttingDown) {
			terminal.prompt();
		}

		return;
	}


	// ----------------------------------------------------------
	// HELP
	// ----------------------------------------------------------

	if (command === 'help') {
		console.log('');
		console.log('Available terminal commands:');
		console.log('');
		console.log('  stop      Stop the bot cleanly');
		console.log('  shutdown  Stop the bot cleanly');
		console.log('  quit      Stop the bot cleanly');
		console.log('  status    Show bot status');
		console.log('  help      Show this help');
		console.log('');

		if (!shuttingDown) {
			terminal.prompt();
		}

		return;
	}


	// ----------------------------------------------------------
	// UNKNOWN COMMAND
	// ----------------------------------------------------------

	console.log(
		`Unknown command: "${command}". Type "help".`,
	);

	if (!shuttingDown) {
		terminal.prompt();
	}
});


// ============================================================
// ERREUR TERMINAL
// ============================================================

terminal.on('close', () => {
	/*
	 * Si le terminal est fermé sans passer par "stop",
	 * on ne lance PAS un deuxième shutdown.
	 */
	if (!shuttingDown) {
		console.log(
			'[TERMINAL] Terminal input closed.',
		);
	}
});


// ============================================================
// INITIALISATION DE SQLITE
// ============================================================

const initializeDatabase = () => {
	try {
		console.log(
			'Initializing SQLite database...',
		);

		client.database = openDatabase();

		/*
		 * IMPORTANT :
		 * Personnel.js utilise exactement la même
		 * connexion SQLite que le reste du bot.
		 */
		personnel.setDatabase(client.database);

		console.log(
			'SQLite database initialized successfully.',
		);

		return true;
	}
	catch (error) {
		console.error(
			'Impossible d’initialiser la base SQLite:',
			error,
		);

		return false;
	}
};


// ============================================================
// DÉMARRAGE
// ============================================================

const start = async () => {
	// ----------------------------------------------------------
	// DATABASE
	// ----------------------------------------------------------

	if (!initializeDatabase()) {
		closeDatabase();

		process.exitCode = 1;

		terminal.close();

		return;
	}


	// ----------------------------------------------------------
	// DISCORD LOGIN
	// ----------------------------------------------------------

	try {
		console.log('Connecting to Discord...');

		await client.login(
			process.env.DISCORD_BOT_TOKEN,
		);

		console.log('');
		console.log('========================================');
		console.log('🟢 Bot is online.');
		console.log('========================================');
		console.log('');
		console.log('Type "help" to show terminal commands.');
		console.log('');

		terminal.prompt();
	}
	catch (error) {
		console.error(
			'[LOGIN] Failed to connect to Discord:',
			error,
		);

		try {
			await client.log(
				'LOGIN',
				'ERROR',
				`Échec de connexion à Discord (${error.code || 'erreur inconnue'}).`,
			);
		}
		catch (logError) {
			console.error(
				'[LOGIN] Failed to send login error:',
				logError,
			);
		}

		closeDatabase();

		terminal.close();

		process.exitCode = 1;
	}
};


// ============================================================
// ERREURS NON GÉRÉES
// ============================================================

process.on('uncaughtException', async (error) => {
	console.error('');
	console.error(
		'[FATAL] Uncaught exception:',
		error,
	);

	if (!shuttingDown) {
		await shutdown('uncaughtException');
	}

	process.exitCode = 1;
});


process.on('unhandledRejection', (reason) => {
	console.error('');
	console.error(
		'[ERROR] Unhandled promise rejection:',
		reason,
	);
});


// ============================================================
// START
// ============================================================

start().catch(async (error) => {
	console.error(
		'[FATAL] Startup error:',
		error,
	);

	if (!shuttingDown) {
		await shutdown('startup error');
	}

	process.exitCode = 1;
});
