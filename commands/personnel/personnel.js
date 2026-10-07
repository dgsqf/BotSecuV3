const { SlashCommandBuilder } = require('discord.js');
const { executeDashboard, canOpenDashboard } = require('../../framework_utils/PersonnelDashboardSession.js');

module.exports = {
	cooldown: 3,
	data: new SlashCommandBuilder()
		.setName('personnel')
		.setDescription('Ouvre le dashboard de gestion du personnel.'),
	canExecute: canOpenDashboard,
	async execute(interaction) {
		return executeDashboard(interaction);
	},
};