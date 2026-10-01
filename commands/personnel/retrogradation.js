const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Personnel = require('../../framework_utils/Personnel.js');
const {
	requirePermission,
	reply,
	replyServiceError,
	syncPersonnelRoles,
	runPersonnelForm,
} = require('../../framework_utils/PersonnelDiscord.js');
const { getRank } = require('../../data/hierarchy.js');

module.exports = {
	cooldown: 5,
	data: new SlashCommandBuilder()
		.setName('retrogradation')
		.setDescription('Rétrograde un membre d’un rang dans son échelle.'),
	async execute(interaction) {
		if (!await requirePermission(interaction, 'staff')) return;
		try {
			return runPersonnelForm({
				interaction,
				title: 'Rétrograder un membre',
				description: 'Sélectionnez le membre à rétrograder puis confirmez le motif.',
				fields: [
					{ type: 'user', id: 'utilisateur', label: 'Membre concerné', required: true },
					{ type: 'text', id: 'raison', label: 'Motif de la rétrogradation', required: true },
				],
				onConfirm: async (values) => {
					const user = await interaction.guild.members.fetch(values.utilisateur).catch(() => null);
					const before = await Personnel.getProfile(values.utilisateur);
					const result = await Personnel.demoteMember(values.utilisateur);
					await syncPersonnelRoles(interaction, values.utilisateur, before, result.profile);
					const from = getRank(result.from)?.label || result.from;
					const to = getRank(result.to)?.label || result.to;
					await interaction.client.log('PERSONNEL', 'INFO', `Rétrogradation de ${values.utilisateur} par ${interaction.user.id} : ${from} -> ${to}. Motif : ${values.raison}.`);
					return reply(interaction, new EmbedBuilder().setColor(0xfee75c).setTitle('Rétrogradation appliquée').setDescription(`${user ? user : `<@${values.utilisateur}>`} : **${from} → ${to}**${result.iraChanged ? `; IRA ${before.ira} → ${result.profile.ira}` : ''}.`));
				},
			});
		}
		catch (error) {
			return replyServiceError(interaction, error);
		}
	},
};