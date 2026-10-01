const { REST, Routes } = require('discord.js');

const formatRoleList = (roles) => [
	`Rôles du serveur (${roles.length})`,
	...roles
		.slice()
		.sort((first, second) => second.position - first.position || first.name.localeCompare(second.name, 'fr'))
		.map((role) => `${role.name.replace(/[\t\r\n]/g, ' ')}\t${role.id}`),
].join('\n');

const listRoles = async ({ token = process.env.DISCORD_BOT_TOKEN, guildId = process.env.GUILD_ID } = {}) => {
	if (!token) throw new Error('DISCORD_BOT_TOKEN est absent de .env.');
	if (!/^\d{17,20}$/.test(guildId || '')) throw new Error('GUILD_ID doit contenir un ID de serveur Discord valide.');

	const rest = new REST().setToken(token);
	const roles = await rest.get(Routes.guildRoles(guildId));
	process.stdout.write(`${formatRoleList(roles)}\n`);
};

if (require.main === module) {
	listRoles().catch((error) => {
		console.error(`Impossible de récupérer les rôles : ${error.message}`);
		process.exitCode = 1;
	});
}

module.exports = { formatRoleList, listRoles };