const { Events, MessageFlags, Collection, EmbedBuilder } = require('discord.js');

module.exports = {
	name: Events.InteractionCreate,
	async execute(interaction) {
		if (!interaction.isChatInputCommand()) return;

		const command = interaction.client.commands.get(interaction.commandName);

		if (!command) {
			console.error(`No command matching ${interaction.commandName} was found.`);
			return;
		}
		const { cooldowns } = interaction.client;

		if (!cooldowns.has(command.data.name)) {
	        cooldowns.set(command.data.name, new Collection());
		}

		const now = Date.now();
		const timestamps = cooldowns.get(command.data.name);
		const defaultCooldownDuration = 3;
		const cooldownAmount = (command.cooldown ?? defaultCooldownDuration) * 1_000;

		if (timestamps.has(interaction.user.id)) {
	        const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;

	        if (now < expirationTime) {
		        const expiredTimestamp = Math.round(expirationTime / 1_000);
		        return interaction.reply({
			    embeds: [new EmbedBuilder()
				    .setColor(0xfee75c)
				    .setTitle('Commande en cooldown')
				    .setDescription(`Merci de patienter avant d'utiliser à nouveau la commande \`${command.data.name}\`. Vous pouvez l'utiliser de nouveau <t:${expiredTimestamp}:R>.`)],
			    flags: MessageFlags.Ephemeral,
		    });
			}
		}

		try {
			timestamps.set(interaction.user.id, now);
			setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);
			await command.execute(interaction);
		}
		catch (error) {
			console.error(error);
			const isStaleInteractionError = (err) => err?.code === 10062 || err?.code === 40060;
			if (isStaleInteractionError(error)) {
				return;
			}
			try {
				if (interaction.replied || interaction.deferred) {
					await interaction.followUp({
						embeds: [new EmbedBuilder()
							.setColor(0xed4245)
							.setTitle('Erreur')
							.setDescription('Une erreur est survenue lors de l’exécution de cette commande.')],
						flags: MessageFlags.Ephemeral,
					});
				}
				else {
					await interaction.reply({
						embeds: [new EmbedBuilder()
							.setColor(0xed4245)
							.setTitle('Erreur')
							.setDescription('Une erreur est survenue lors de l’exécution de cette commande.')],
						flags: MessageFlags.Ephemeral,
					});
				}
			}
			catch (replyError) {
				if (!isStaleInteractionError(replyError)) {
					throw replyError;
				}
			}

			timestamps.delete(interaction.user.id);
		}
	},
};