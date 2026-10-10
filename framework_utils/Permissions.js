const fs = require('node:fs');
const path = require('node:path');

const permissionConfigPath = path.join(__dirname, '..', 'permission.json');

const readPermissionConfig = () => JSON.parse(fs.readFileSync(permissionConfigPath, 'utf8'));

const getPermission = (permissionId) => {
	const [namespace, name, ...extra] = String(permissionId).split('.');
	if (!namespace || !name || extra.length) throw new TypeError(`Permission invalide: ${permissionId}`);
	const permission = readPermissionConfig()[namespace]?.permissions?.[name];
	if (!permission) throw new Error(`Permission inconnue: ${permissionId}`);
	return permission;
};

const normalizeRoleIds = (roleIds) => [...new Set((Array.isArray(roleIds) ? roleIds : [])
	.filter((roleId) => typeof roleId === 'string' && /^\d{17,20}$/.test(roleId)))];

const getRoleIds = (permissionId) => normalizeRoleIds(getPermission(permissionId).roles);

const hasRole = (interaction, roleId) => {
	const roles = interaction?.member?.roles;
	return Boolean(roles?.cache?.has?.(roleId) || (Array.isArray(roles) && roles.includes(roleId)));
};

const hasPermission = (interaction, permissionId) => {
	const permission = getPermission(permissionId);
	if (permission.allowDiscordAdministrator && interaction?.member?.permissions?.has?.('Administrator')) return true;
	return getRoleIds(permissionId).some((roleId) => hasRole(interaction, roleId));
};

const getNamespaces = () => Object.entries(readPermissionConfig())
	.map(([name, namespace]) => ({
		name,
		description: namespace.description,
		permissions: Object.entries(namespace.permissions || {})
			.map(([permissionName, permission]) => ({
				id: `${name}.${permissionName}`,
				name: permissionName,
				description: permission.description,
				roles: getRoleIds(`${name}.${permissionName}`),
			}))
			.sort((left, right) => left.name.localeCompare(right.name)),
	}))
	.sort((left, right) => left.name.localeCompare(right.name));

const setRoleIds = (permissionId, roleIds) => {
	if (!Array.isArray(roleIds) || roleIds.some((roleId) => typeof roleId !== 'string' || !/^\d{17,20}$/.test(roleId))) {
		throw new TypeError(`La liste de rôles est invalide pour ${permissionId}.`);
	}
	getPermission(permissionId);
	const config = readPermissionConfig();
	const [namespace, name] = permissionId.split('.');
	config[namespace].permissions[name].roles = [...new Set(roleIds)];
	const temporaryPath = `${permissionConfigPath}.tmp`;
	fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
	fs.renameSync(temporaryPath, permissionConfigPath);
};

const isDiscordAdministrator = (interaction) => Boolean(interaction?.member?.permissions?.has?.('Administrator'));

module.exports = {
	getNamespaces,
	getPermission,
	getRoleIds,
	hasRole,
	hasPermission,
	isDiscordAdministrator,
	setRoleIds,
};
