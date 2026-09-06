const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Form = require('../../framework_utils/Form.js');
const { Prompt } = require('../../framework_utils/Prompt.js');
const { disciplinaireForumChannelId } = require('../../config.json');

const getUserThread = async (forumChannel, username) => {

	const cacheThreads = forumChannel?.threads?.cache ?? [];
	const normalizedUsername = String(username).toLowerCase();
	const cachedThread = cacheThreads.find((thread) => thread?.name?.toLowerCase() === normalizedUsername);
	if (cachedThread) return cachedThread;

	const fetchedThreads = await forumChannel.threads.fetch();
	const threadCollection = fetchedThreads?.threads ?? fetchedThreads ?? [];
	return threadCollection.find((thread) => thread?.name?.toLowerCase() === normalizedUsername) ?? null;
};

module.exports = {
	cooldown: 5,
	data: new SlashCommandBuilder()
		.setName('sanction')
		.setDescription('Ouvre le formulaire de création de sanction'),
	async execute(interaction) {
		const form = new Form({ title: 'Sanction', description: 'Veuillez remplir le formulaire pour créer une sanction.' })
			.choice('type', 'Type de sanction', ['Avertissement formel', 'Blâme', 'Envoie devant le Conseil de Discipline', 'Retrogradation', 'Suspension', 'Exclusion definitive'])
			.user('user', 'Utilisateur sanctionné')
			.text('article', 'Article du code de conduite non respécté')
			.text('alinea', 'Alinea non respecté')
			.text('details', 'Détails de la sanction (contexte, preuves, etc.)');
		await form.send(interaction, { onConfirm: async (values) => {
			const channel = await interaction.client.channels.fetch(disciplinaireForumChannelId);
			const sanctionedUserId = String(values.user);
			const sanctionedUser = await interaction.client.users.fetch(sanctionedUserId);
			const post = await getUserThread(channel, sanctionedUser.username);

			if (!post) {
				await interaction.followUp({ content: 'Aucun post disciplinaire correspondant à cet utilisateur n’a été trouvé.', ephemeral: true });
				return;
			}

			const embed = new EmbedBuilder()
				.setTitle('Nouvelle sanction disciplinaire')
				.setColor(0xD32F2F)
				.addFields(
					{ name: 'Agent sanctionné', value: String(values.user) },
					{ name: 'Type de sanction', value: String(values.type) },
					{ name: 'Article', value: String(values.article) },
					{ name: 'Alinéa', value: String(values.alinea) },
					{ name: 'Détails', value: String(values.details) },
					{ name: 'Sanction créée par', value: `${interaction.user}` },
				);
			await post.send({ embeds: [embed] });
			await interaction.followUp({ content: 'La sanction a été envoyée dans le dossier disciplinaire.', ephemeral: true });
		}, ephemeral: true });
	},

};
