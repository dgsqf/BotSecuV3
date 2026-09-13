const { Events, MessageFlags, Collection, EmbedBuilder } = require('discord.js');
const { createUserErrorEmbed } = require('../framework_utils/Logging.js');

module.exports = {
	name: Events.InteractionCreate,
	async execute(interaction) {
		if (!interaction.isChatInputCommand()) return;

		const command = interaction.client.commands.get(interaction.commandName);

		if (!command) {
			await interaction.client.log('INTERACTION CREATE', 'ERROR', `Commande introuvable: ${interaction.commandName}.`);
			await interaction.reply({ content: 'Cette commande est indisponible. Vous pouvez ouvrir un ticket afin que notre équipe puisse la corriger.', flags: MessageFlags.Ephemeral });
			return;
		}
		const { cooldowns } = interaction.client;
		const cooldownLogs = interaction.client.cooldownLogs ?? new Collection();
		interaction.client.cooldownLogs = cooldownLogs;

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
		        await interaction.reply({
			    embeds: [new EmbedBuilder()
				    .setColor(0xfee75c)
				    .setTitle('Commande en cooldown')
				    .setDescription(`Merci de patienter avant d'utiliser à nouveau la commande \`${command.data.name}\`. Vous pouvez l'utiliser de nouveau <t:${expiredTimestamp}:R>.`)],
			    flags: MessageFlags.Ephemeral,
		    });
				const cooldownLogKey = `${command.data.name}:${interaction.user.id}`;
				if (!cooldownLogs.has(cooldownLogKey)) {
					cooldownLogs.set(cooldownLogKey, true);
					setTimeout(() => cooldownLogs.delete(cooldownLogKey), Math.max(0, expirationTime - now));
					await interaction.client.log('COOLDOWN', 'WARN', `L'utilisateur ${interaction.user.tag} <@${interaction.user.id}> a utilisé la commande ${command.data.name} trop de fois.`);
				}
				return;
			}
		}

		try {
			timestamps.set(interaction.user.id, now);
			setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);
			await command.execute(interaction);
		}
		catch (error) {
			await interaction.client.log('INTERACTION CREATE', 'ERROR', `Erreur lors de l'exécution de la commande ${command.data.name}: ${error.stack || error}`);
			const isStaleInteractionError = (err) => err?.code === 10062 || err?.code === 40060;
			if (isStaleInteractionError(error)) {
				return;
			}
			try {
				if (interaction.replied || interaction.deferred) {
					await interaction.followUp({
						embeds: [createUserErrorEmbed(`l’exécution de la commande \`${command.data.name}\``)],
						flags: MessageFlags.Ephemeral,
					});
				}
				else {
					await interaction.reply({
						embeds: [createUserErrorEmbed(`l’exécution de la commande \`${command.data.name}\``)],
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