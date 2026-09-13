const { EmbedBuilder } = require('discord.js');

const SEVERITIES = {
	INFO: {
		color: 0x5865f2,
		label: 'Information',
	},
	WARN: {
		color: 0xfee75c,
		label: 'Avertissement',
	},
	ERROR: {
		color: 0xed4245,
		label: 'Erreur',
	},
};

const createUserErrorEmbed = (context = 'cette action') => new EmbedBuilder()
	.setColor(SEVERITIES.ERROR.color)
	.setTitle('Une erreur est survenue')
	.setDescription(`Une erreur est survenue pendant ${context}. Vous pouvez ouvrir un ticket afin que notre équipe puisse la corriger.`);

/**
 * Creates a logger that writes to the console and to a Discord channel.
 * @param {import('discord.js').Client} client Discord client.
 * @param {string} channelId ID of the channel receiving log embeds.
 * @returns {(moduleName: string, severity: 'INFO'|'WARN'|'ERROR', message: string, sendEmbed?: boolean) => Promise<void>}
 */
function createLogger(client, channelId) {
	if (!client) throw new TypeError(`[ERROR] [Logging ${new Date().toISOString()}] A Discord client is required to create a logger.`);

	return async function log(moduleName, severity, message, sendEmbed = true) {
		const normalizedSeverity = String(severity).toUpperCase();
		const severityConfig = SEVERITIES[normalizedSeverity];

		if (!severityConfig) {
			throw new RangeError(`[ERROR] [Logging ${new Date().toISOString()}] Unknown log severity: ${severity}. Expected INFO, WARN or ERROR.`);
		}

		const logMessage = `[${normalizedSeverity} ${new Date().toISOString()}] [${moduleName}] ${message}`;
		if (normalizedSeverity === 'ERROR') console.error(logMessage);
		else if (normalizedSeverity === 'WARN') console.warn(logMessage);
		else console.info(logMessage);

		if (!sendEmbed) return;

		if (!channelId) {
			console.warn(`[WARN] [Logging ${new Date().toISOString()}] Aucun canal de logs n'est configuré.`);
			return;
		}

		try {
			const channel = await client.channels.fetch(channelId);
			if (!channel?.isTextBased()) {
				console.warn(`[WARN] [Logging ${new Date().toISOString()}] Le canal de logs ${channelId} est introuvable ou n'est pas textuel.`);
				return;
			}

			await channel.send({
				embeds: [new EmbedBuilder()
					.setColor(severityConfig.color)
					.setTitle(`${severityConfig.label} - ${moduleName}`)
					.setDescription(String(message))
					.setTimestamp()],
			});
		}
		catch (error) {
			console.error(`[ERROR] [Logging ${new Date().toISOString()}] Impossible d'envoyer le log dans le canal ${channelId}:`, error);
		}
	};
}

module.exports = { createLogger, createUserErrorEmbed };
