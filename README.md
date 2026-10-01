# BotSecuV3

## Avant le premier lancement

### 1. Installer les dépendances

À la racine du dépôt, exécutez :

```sh
npm install
```

Le projet utilise Node.js 22 ou plus récent et `better-sqlite3`. Si l’installation du module natif échoue, installez les outils de compilation C/C++ de votre système, puis relancez `npm install`.

### 2. Préparer `.env`

Copiez `.env.example` vers `.env` et renseignez les valeurs suivantes :

| Variable            | Valeur à renseigner                                                                      | Où la trouver                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `DISCORD_BOT_TOKEN` | Token du bot, secret                                                                     | Discord Developer Portal → votre application → Bot → Reset Token / Token                                          |
| `CLIENT_ID`         | ID de l’application Discord                                                              | Developer Portal → General Information → Application ID                                                           |
| `GUILD_ID`          | ID du serveur où déployer les commandes                                                  | Discord → Paramètres avancés → Mode développeur, puis clic droit sur le serveur → Copier l’identifiant du serveur |
| `LOG_CHANNEL_ID`    | Facultatif : ID du salon de logs; si vide, `logChannelId` dans `config.json` est utilisé | Mode développeur, clic droit sur le salon → Copier l’identifiant du salon                                         |
| `SQLITE_PATH`       | Facultatif : chemin du fichier de base; par défaut `data/personnel.sqlite`               | Chemin de fichier local ou volume persistant de l’hébergement                                                     |

Ne partagez jamais le token du bot et ne commitez jamais `.env`. `.env.example` ne contient que des valeurs factices.

Pour afficher les rôles du serveur et leurs IDs dans le terminal, vérifiez que le bot appartient au serveur indiqué par `GUILD_ID`, qu’il possède la permission **Gérer les rôles**, puis exécutez :

```sh
npm run list-roles
```

Le script utilise `DISCORD_BOT_TOKEN` et `GUILD_ID` dans `.env`; il n’enregistre rien et n’a pas besoin de déployer une commande slash.

### 3. Installer le bot sur le serveur

Dans le Developer Portal, ouvrez **OAuth2 → URL Generator**, cochez les scopes `bot` et `applications.commands`, puis installez l’application dans le serveur dont l’ID est `GUILD_ID`. Donnez au bot les permissions utilisées par les fonctionnalités activées : voir les salons, envoyer des messages et intégrer des liens, lire l’historique, ajouter des réactions, créer des fils publics et y envoyer des messages. Les commandes de recrutement et la synchronisation facultative des rôles nécessitent aussi **Gérer les salons** et **Gérer les rôles**. Vérifiez que le rôle du bot est placé assez haut pour attribuer les rôles configurés.

### 4. Renseigner `config.json`

Activez le Mode développeur Discord. Copiez toujours les IDs directement depuis Discord et gardez-les entre guillemets : les IDs de serveur, salon et rôle sont des chaînes, jamais des nombres.

| Clé                        | Valeur attendue                                                                                                                       | Où récupérer l’ID                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `personnelStaffRoleIds`    | Liste des IDs de rôles autorisés pour les sanctions, promotions/rétrogradations et corrections manuelles d’activité                   | Paramètres du serveur → Rôles → clic droit sur chaque rôle → Copier l’identifiant du rôle                       |
| `personnelAdminRoleIds`    | Liste des IDs de rôles autorisés à créer/supprimer des profils, modifier les informations/divisions et définir manuellement les rangs | Même méthode; choisissez les rôles d’administration du personnel                                                |
| `personnelBranchRoleIds`   | Objet branche → liste d’IDs de rôles à synchroniser (EIT, BG, COMMANDEMENT)                                                           | Une ou plusieurs listes; les rôles de branche restent séparés de ceux de division                               |
| `personnelDivisionRoleIds` | Objet division → liste d’IDs de rôles à synchroniser (ULB, URR, UPR, UMS)                                                             | Configurez chaque division indépendamment, même si les rôles portent le même nom                                |
| `personnelIraRoleIds`      | Objet IRA `1` à `7` → liste d’IDs de rôles pour chaque niveau                                                                         | Copiez les IDs des rôles IRA; l’ancien niveau est retiré et le nouveau ajouté quand l’IRA change                |
| `promotionChannelId`       | ID du salon texte où publier les résultats des vagues                                                                                 | Clic droit sur le salon → Copier l’identifiant du salon                                                         |
| `sanctionTypes`            | Types de sanction proposés dans la commande                                                                                           | Adaptez les libellés à votre règlement; ce ne sont pas des IDs                                                  |
| `activityPointsPerReport`  | Nombre de points ajouté à l’auteur après l’envoi réussi d’un rapport                                                                  | Choisissez le barème souhaité; `0` désactive l’attribution                                                      |
| `personnelRankRoleIds`     | Deux objets (`branches` et `divisions`), chacun associant branche/division puis rang à une liste d’IDs de rôles                       | Les rangs homonymes sont configurés séparément, par exemple `divisions.ULB.recrue` et `divisions.URR.recrue`    |
| `personnelRankLimits`      | Plafonds facultatifs par rang, sous `branches` ou `divisions`                                                                         | Exemple : `"branches": { "DIRECTION": { "directeur": 1 } }`; un rang absent de la configuration est sans limite |
| `promotionDirectMessages`  | `true` pour envoyer un MP aux membres promus, sinon `false`                                                                           | Réglage booléen, pas un ID                                                                                      |

Les valeurs `REMPLACER_PAR_...` sont des rappels, pas des IDs valides. Remplacez-les avant d’utiliser ces commandes. Les rôles staff/admin vides ou invalides refusent l’accès. `/promotion vague` reste désactivée tant que `promotionChannelId` n’est pas un ID Discord numérique valide. Un administrateur doit aussi être ajouté à `personnelStaffRoleIds` s’il doit utiliser les commandes staff : les deux listes sont indépendantes.

Chaque valeur de `personnelBranchRoleIds`, `personnelDivisionRoleIds`, `personnelIraRoleIds`, `personnelRankRoleIds.branches` et `personnelRankRoleIds.divisions` est un tableau, même s’il ne contient qu’un rôle. Ajoutez plusieurs IDs dans le même tableau si une branche, une division, un niveau IRA ou un rang doit donner plusieurs rôles. Exemple : `"ULB": ["ID_ROLE_ULB_1", "ID_ROLE_ULB_2"]`. Les rôles de branche, division, rang et IRA sont synchronisés à la création/suppression d’un profil et lors d’un changement de branche, division, rang, promotion ou rétrogradation. Si l’API Discord refuse une modification de rôle, le profil reste enregistré et l’échec est logué.

Les autres IDs déjà présents dans `config.json` correspondent aux salons, rôles et tags utilisés par les fonctionnalités existantes. Ne les modifiez que si vous souhaitez reconfigurer ces fonctionnalités; ils se copient de la même manière.

Le modèle de profils couvre EIT, BG, COMMANDEMENT, DIRECTION et COMMISSION, ainsi que les divisions BG ULB, URR, UPR et UMS. Direction et Commission sont des branches indépendantes : elles ne peuvent pas être affectées à une division BG. Leurs échelles sont respectivement Directeur adjoint → Directeur (IRA 8) et Officier de commission (IRA 6) → Commissaire du conseil de sûreté (IRA 7). « Représentant de département » concerne les autres départements et n’est pas un rang de la sécurité. Les rôles de rang de Direction et Commission restent manuels et sont déclarés dans `personnelManualRoleGroups`; le bot gère les profils et rangs, mais n’attribue ni ne retire ces rôles. `/personnel profil` affiche les rôles correspondants effectivement détenus. Les rôles Directeur et Directeur adjoint restent autorisés à utiliser les fonctions admin via `personnelAdminRoleIds`.

Les plafonds de `personnelRankLimits` sont appliqués aux créations, réactivations, changements de rang/branche/division, rétrogradations et promotions. Seuls les profils actifs occupent une place. Les postes du Commandement, les capitaines, les majors et les lieutenants ont chacun une limite de 1 par échelle; les postes de Direction et de Commission déjà configurés sont également plafonnés à 1. Les limites des divisions sont indépendantes entre ULB, URR, UPR et UMS. Les autres rangs restent illimités tant qu’aucun plafond n’est ajouté. `/hierarchie` affiche une branche ou division par page et indique l’effectif courant des rangs limités.

### 5. Déployer les commandes et lancer

Déployez les commandes sur le serveur indiqué par `GUILD_ID`, puis démarrez le bot :

```sh
npm run deploy-commands
npm start
```

Au démarrage, SQLite crée automatiquement les tables et index dans `data/personnel.sqlite`. Le dossier est créé si nécessaire. Pour un hébergement conteneurisé, montez un volume persistant et définissez `SQLITE_PATH` vers ce volume, sinon la base pourrait être perdue lors d’un redéploiement. La base, ses fichiers WAL et `.env` ne doivent pas être commités.

## Tests automatisés

```sh
npm test
npx eslint index.js events/interactionCreate.js framework_utils/Database.js framework_utils/Personnel.js framework_utils/PersonnelDiscord.js data/hierarchy.js commands/personnel commands/rapports/rapports.js test
```

Les tests automatisés couvrent les échelles, les promotions, les transitions de division, les transactions d’activité, les sanctions et la migration de la base de données vers les branches Direction et Commission.

## Checklist de tests dans Discord

Faites les tests dans un serveur de test et avec des comptes de test. Configurez les IDs staff/admin et le salon de promotion avant de tester les fonctions protégées.

1. **Démarrage et persistance** : lancer `npm start`; vérifier que le bot passe en ligne, que `data/personnel.sqlite` apparaît et qu’aucune erreur SQLite n’est loguée. Arrêter avec `Ctrl+C`, relancer, puis confirmer que les profils et totaux sont encore là.
2. **Permissions fermées** : temporairement laisser un des tableaux de rôles vide, ou utiliser un compte sans ce rôle; vérifier que la commande concernée répond « Accès refusé » et ne change aucune donnée.
3. **Création de profil** : par exemple, utiliser `/personnel creer` avec `utilisateur=@Test`, `prenom=Test`, `nom=EIT`, `branche=EIT`, `rang=recrue-eit`; créer aussi un BG sans division, puis un BG dans chacune des divisions ULB, URR, UPR et UMS avec le rang `recrue`. Vérifier le rang BG correspondant et l’IRA. Relancer la création pour le même utilisateur et vérifier le message de doublon.
4. **Profil et modifications** : vérifier `/personnel profil`; modifier prénom, nom et statut; confirmer que le statut inactif est visible et que le membre disparaît des tops. Changer de division, puis quitter la division et vérifier que le rang BG courant est conservé. Essayer `/personnel branche` pour passer de BG à EIT puis à BG/UPR; vérifier le nouveau rang de départ, l’IRA et le retrait/ajout des rôles de branche et de division. Essayer la gestion de division sur un profil EIT et vérifier le refus.
5. **Rang manuel et hiérarchie** : essayer `/personnel rang` avec un rang de l’échelle du membre, puis avec un rang d’une autre échelle et vérifier le refus. Comparer `/hierarchie` avec les rangs attendus.
6. **Activité manuelle** : essayer `/activite points-ajouter` puis `/activite points-retirer` avec le même membre; `/activite heures-ajouter` avec `montant=1.25` doit ajouter `1 h 15`; tester aussi `/activite heures-retirer`. Vérifier `/activite voir`, puis `/activite top` pour les deux types et les trois périodes. Pour tester réellement les boutons de pagination, créer au moins 11 profils actifs. Essayer une opération avec un membre sans profil : elle doit rester non bloquante et produire un log WARN.
7. **Rapport** : soumettre un rapport d’essai avec un auteur ayant un profil et vérifier l’ajout de `activityPointsPerReport`. Tester aussi un auteur sans profil : le rapport doit quand même être envoyé.
8. **Sanctions** : essayer `/sanction ajouter` pour chaque type configuré, consulter `/sanction historique`, vérifier le nombre actif dans `/personnel profil`, puis `/sanction revoquer` avec le numéro de dossier et une raison. Vérifier que la sanction n’est plus active mais reste dans l’historique si les révoquées sont incluses. Vérifier qu’un type non configuré est refusé.
9. **Promotion** : créer des profils au milieu et au sommet de leurs échelles. Dans `/promotion vague`, sélectionner plusieurs membres, retirer un membre, afficher/actualiser l’aperçu, vérifier les changements d’IRA, puis annuler une première vague. En lancer une seconde et confirmer : seuls les promouvables doivent avancer d’un rang, les sommets/commandements doivent apparaître en échec, et un récapitulatif doit être publié dans le salon configuré.
10. **Rétrogradation et suppression** : rétrograder un membre d’un rang; essayer de rétrograder le rang le plus bas. Supprimer un profil après confirmation et vérifier que son profil, ses journaux d’activité et sanctions ne sont plus consultables.
11. **Erreur de configuration** : utiliser un ID de salon de promotion invalide dans un environnement de test; vérifier que la commande refuse de commencer et qu’aucune promotion n’est appliquée. Laisser volontairement certains rôles de branche/division/rang en placeholder; les autres rôles valides doivent tout de même être synchronisés sans tenter d’ajouter les placeholders.

La synchronisation facultative des rôles et les MP de promotion doivent être testés séparément après les avoir activés dans `config.json`. Le déploiement des commandes touche l’API Discord; ne le lancez qu’après avoir vérifié `CLIENT_ID`, `GUILD_ID` et le token.
