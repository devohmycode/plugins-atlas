# plugins-atlas — tâches

Catalogue public de plugins d’agents, avec le même geste que skills-atlas et mcp-atlas : chercher, lire, contrôler, puis installer.

Une case se coche quand la ligne « Fait quand » est vraie. **Dépend de** ne liste que les dépendances directes. Une tâche peut démarrer quand elles sont toutes cochées. Les tâches d’une même vague n’ont pas de dépendance entre elles.

## Choix déjà posés

- Dépôt séparé, même pile que mcp-atlas : Node ≥ 20, TypeScript, Commander, Ink, zod, Vitest, tsup. Pas de librairie partagée avec mcp-atlas ou skills-atlas : du code peut y être recopié.
- Un plugin est un paquet déclaratif (skills, commandes, sous-agents, hooks, serveurs MCP) publié dans une marketplace. L’unité du catalogue est un plugin dans une marketplace.
- Identité : `plugin@marketplace`, comme Claude Code. Une marketplace s’identifie par sa source : `github:owner/repo`, sinon l’URL git.
- Agents, niveau 1 (format `.claude-plugin/` et `marketplace.json`) : Claude Code, Claude Desktop / Cowork, GitHub Copilot CLI, Factory Droid. Niveau 2 (marketplace propre, format voisin) : Codex CLI, Codex desktop, Cursor. Codex CLI et Codex desktop partagent les mêmes fichiers.
- Tâches propres au niveau 2 : T9, T13, T34, T35.
- Aucune conversion de format. Un plugin ne s’installe que dans les agents qui savent lire l’un de ses manifestes.
- Aucun plugin n’est exécuté : ni hook, ni serveur MCP, ni script, ni pour lister ses composants, ni pour lire son README. Tout vient des fichiers du dépôt déclaré, lus un par un, sans cloner.
- Installer passe par la commande officielle de l’agent quand elle existe, sinon par l’écriture de ses fichiers. `docs/agents.md` (T4) tranche pour chaque agent.
- Un risque haut bloque l’installation. `--dry-run` n’écrit rien et ne lance aucune commande.

Hors de cette liste : niveau 3 (extensions Gemini CLI et Antigravity, plugins JS d’OpenCode et de Pi), conversion entre formats, langues multiples, packs, recommandés, fichier de projet partagé avec `sync`.

## Vagues

| Vague | Tâches |
| --- | --- |
| 0 | T1, T4 |
| 1 | T2, T3, T25 |
| 2 | T5, T7, T16, T26 |
| 3 | T6, T8, T14, T15 |
| 4 | T9, T10, T23 |
| 5 | T11, T12, T13, T17, T24 |
| 6 | T18, T27 |
| 7 | T19, T20, T21, T22, T28, T29 |
| 8 | T30, T31, T32, T33, T34, T35 |
| 9 | T36 |
| 10 | T37, T38 |
| 11 | T39 |
| 12 | T40, T41, T42, T43, T44, T45, T46 |

## Tâches

### Socle

- [x] **T1** — Squelette du dépôt
  - Dépend de : aucune
  - Fait quand : `package.json` (nom `plugins-atlas`, binaire `plugins-atlas`, `"type": "module"`, Node ≥ 20, MIT), `tsconfig.json`, tsup, Vitest, `.gitignore` et un `src/cli.ts` qui affiche l’aide. `npm test`, `npm run typecheck` et `npm run build` passent.

- [x] **T2** — Types du catalogue
  - Dépend de : T1
  - Fait quand : `src/types.ts` exporte `Origin`, `RawPlugin`, `Plugin`, `Marketplace`, `MarketplaceSource`, `PluginSource`, `Components` (skills, commands, agents, hooks, mcpServers), `Theme`, `Catalog` (version 1), `Scope` (`project` | `user`), `AgentId`. Une fiche porte `id`, `name`, `marketplace`, `description`, `version`, `author`, `repository`, `source`, `components`, `agents` (compatibles), `origins`, `themes`, `official`.

- [x] **T3** — Client HTTP
  - Dépend de : T1
  - Fait quand : un fetch avec timeout, plafond de pages et User-Agent. Un corps qui n’est pas du JSON, ou une page au-delà du plafond, produit une erreur nommée. Aucun réessai en boucle. Un jeton GitHub pris dans `GITHUB_TOKEN`, s’il existe, n’est envoyé qu’à `api.github.com` et `raw.githubusercontent.com`.

- [x] **T4** — Fiche technique des agents
  - Dépend de : aucune
  - Fait quand : `docs/agents.md` donne, pour chacun des sept agents : les manifestes qu’il lit (`.claude-plugin/plugin.json`, `.github/plugin/plugin.json`, manifeste Codex, manifeste Cursor…), le fichier de marketplace, le mécanisme d’installation (commande officielle avec ses arguments, ou fichiers et clés à écrire), les scopes, l’endroit où se lisent l’installé et l’activé, la désinstallation, la mise à jour, les chemins sous Windows, macOS et Linux. Chaque ligne cite la doc officielle et sa date de lecture. Ce que la doc ne dit pas est écrit « non documenté ». Aucun code ne s’appuie sur un format absent de ce fichier.

- [x] **T5** — Identité
  - Dépend de : T2
  - Fait quand : des fonctions pures parsent et formatent `plugin@marketplace` et l’id d’une source de marketplace. Un id vide, avec une espace, sans `@`, ou qui peut passer pour une option (`-y`) est rejeté. Tests sur ces cas.

### Formats

- [x] **T6** — Parseur de `marketplace.json`
  - Dépend de : T2, T5
  - Fait quand : un schéma zod lit `name`, `owner`, `plugins[]` (nom, source, version, description, catégorie, mots-clés, auteur). Les sources de plugin chemin relatif, GitHub, URL git, avec ou sans `ref`/`sha`, deviennent un `PluginSource`. Une forme inconnue donne une erreur qui nomme le champ. Tests sur une fixture de vraie marketplace.

- [x] **T7** — Parseur de `plugin.json` et des composants
  - Dépend de : T2, T4
  - Fait quand : à partir du manifeste et de la liste des fichiers du plugin, `Components` est rempli : skills (`skills/*/SKILL.md`), commandes, sous-agents, hooks (`hooks/hooks.json` ou champ du manifeste), serveurs MCP (`.mcp.json` ou champ du manifeste). Les chemins par défaut et ceux déclarés dans le manifeste sont lus tous les deux. Un chemin qui sort du plugin (`..`, absolu) est rejeté. Tests sur fixtures.

- [x] **T8** — Compatibilité, niveau 1
  - Dépend de : T7
  - Fait quand : les manifestes présents dans un plugin donnent la liste des agents de niveau 1 qui peuvent l’installer, selon `docs/agents.md`. Un plugin sans manifeste lisible n’est compatible avec aucun agent, sauf Claude Code quand il vient d’une `.claude-plugin/marketplace.json`, dont l’entrée tient lieu de manifeste. Tests : plugin `.claude-plugin/` seul, plugin `.github/plugin/plugin.json` seul, plugin avec les deux.

- [x] **T9** — Manifestes Codex et Cursor (niveau 2)
  - Dépend de : T4, T8
  - Fait quand : les manifestes de plugin et de marketplace de Codex et de Cursor sont lus vers les mêmes `Components` et `PluginSource`. T8 marque alors aussi `codex-cli`, `codex-desktop` et `cursor`. Tests sur une fixture de chaque format.

### Catalogue

- [x] **T10** — Interface `Source`, et source claude-plugins.dev
  - Dépend de : T3, T6
  - Fait quand : l’interface `Source` est `fetch(): Promise<RawPlugin[]>`, avec un nom d’origine. Une source claude-plugins.dev remplit des `RawPlugin` depuis une fixture. Si la forme distante change, l’erreur dit que le contrat a bougé. Les tests lisent une fixture, pas le réseau.

- [x] **T11** — Source marketplace officielle d’Anthropic
  - Dépend de : T10
  - Fait quand : la marketplace officielle (dépôt désigné par la doc Claude Code au moment du code) est lue via T6. Ses plugins portent l’origine `official`.

- [x] **T12** — Source recherche GitHub
  - Dépend de : T10
  - Fait quand : la recherche de code GitHub trouve les dépôts qui contiennent `.claude-plugin/marketplace.json`, puis chaque fichier est lu via T6. Sans `GITHUB_TOKEN`, la source est sautée et nommée. Le plafond de pages de T3 s’applique.

- [x] **T13** — Sources Codex et Cursor (niveau 2)
  - Dépend de : T9, T10
  - Fait quand : les marketplaces de Codex et de Cursor que `docs/agents.md` désigne remplissent des `RawPlugin` depuis une fixture, avec le même critère de contrat que T10.

- [x] **T14** — Lecture d’un dépôt de plugin
  - Dépend de : T3, T5, T7
  - Fait quand : pour une source de plugin GitHub, la liste des fichiers vient de l’API des arbres git et les fichiers utiles (manifestes, `hooks.json`, `.mcp.json`, README) de raw GitHub, à la `ref` ou au `sha` déclaré s’il existe. Rien n’est cloné, rien n’est lancé. Une source qui n’est pas sur GitHub est marquée « composants inconnus ». Les tests servent une fixture locale.

- [x] **T15** — Dédoublonnage
  - Dépend de : T5
  - Fait quand : `dedupe(raw)` rend une fiche par `plugin@marketplace`. Les origines sont unies, la description la plus longue gagne, la version de la marketplace gagne sur celle d’un annuaire. Deux marketplaces qui publient le même dépôt de plugin gardent deux fiches, liées par `repository`. Tests avec la même fiche venue de deux origines.

- [x] **T16** — Taxonomie et classification
  - Dépend de : T2
  - Fait quand : `taxonomy.ts` exporte une liste fermée d’ids stables, dont `other`. La catégorie déclarée par la marketplace l’emporte. Sinon nom, description et mots-clés donnent un ou deux thèmes, le premier étant le principal. Sans correspondance, le thème est `other`. Une fixture de plugins connus tombe dans le thème attendu.

- [x] **T17** — Assemblage
  - Dépend de : T8, T10, T14, T15, T16
  - Fait quand : `buildCatalog` interroge les sources données, lit chaque dépôt de plugin, dédoublonne, classe, calcule la compatibilité et remplit `stats` (brut par origine, fusionnés, officiels, par thème, par agent). Une source ou un dépôt en échec est nommé et sauté. Si toutes les sources échouent, l’assemblage échoue.

- [x] **T18** — Instantané et chargement
  - Dépend de : T17
  - Fait quand : le catalogue s’écrit en `data/catalog.json.gz` et se relit avec contrôle du schéma (zod). Un fichier trop vieux de forme, ou tronqué, échoue avec le champ en cause. `generatedAt` est présent.

- [x] **T19** — Rafraîchissement
  - Dépend de : T18
  - Fait quand : sans réseau, le CLI sert l’instantané du paquet. En ligne, il cherche un instantané plus récent au plus toutes les 12 heures et le met en cache. `--refresh` force la vérification. `--offline` ne contacte pas le réseau.

- [x] **T20** — Script de crawl
  - Dépend de : T11, T12, T13, T18
  - Fait quand : `npm run crawl` écrit `data/catalog.json.gz` et imprime les comptes. Zéro plugin de la marketplace officielle fait échouer le script. Une autre source vide est imprimée et ne fait pas échouer.

- [x] **T21** — Recherche
  - Dépend de : T18
  - Fait quand : la recherche filtre par mots (nom, description, mots-clés, id), par thème, par agent compatible et par `--official`. Le tri met devant les fiches officielles présentes dans plusieurs origines. Sortie programmable par les tests, sans CLI encore.

- [x] **T22** — Aperçu
  - Dépend de : T14, T18
  - Fait quand : pour un id, l’aperçu montre le README du plugin et la liste de ses composants (skills, commandes, sous-agents, hooks avec leurs événements, serveurs MCP avec leur commande), lus via T14. Pas de dépôt lisible : erreur lisible.

### Contrôle

- [x] **T23** — Risques
  - Dépend de : T7, T14
  - Fait quand : chaque hook et chaque serveur MCP est examiné. Haut : une commande qui télécharge et exécute (`curl|sh`, `npx -y` ou `uvx` sans version), qui lit un chemin de secret (`~/.ssh`, `~/.aws`), ou une URL distante dont l’hôte n’est ni celui du dépôt ni un registre connu. Moyen : tout hook qui lance une commande, une source de plugin ou de marketplace sans `ref` ni `sha`, une variable dont le nom contient KEY, TOKEN, SECRET ou PASSWORD. Info : un plugin fait seulement de skills, commandes et sous-agents. Les tests couvrent un cas de chaque niveau.

- [x] **T24** — Audit
  - Dépend de : T23
  - Fait quand : au moins un risque haut fait échouer l’audit. Un composant illisible rend le plugin « non audité », pas « en échec ». Le drapeau et le réglage persistant sont prévus ici : refus par défaut, passage seulement si l’audit est coupé pour cette fois ou dans la config.

### Agents

- [x] **T25** — Table des agents
  - Dépend de : T4
  - Fait quand : un tableau reprend `docs/agents.md` en code : pour chaque agent, son id (`claude-code`, `claude-desktop`, `copilot-cli`, `droid`, `codex-cli`, `codex-desktop`, `cursor`), son niveau, les manifestes qu’il lit, son mécanisme (`cli` ou `files`), ses scopes et ses chemins par système. `codex-cli` et `codex-desktop` pointent vers les mêmes fichiers.

- [x] **T26** — Détection
  - Dépend de : T25
  - Fait quand : un agent est détecté si son exécutable est dans le `PATH` ou si son dossier de config existe. `codex-desktop` se détecte par l’application de bureau, pas par `~/.codex` seul. Les fonctions `exists` et `which` sont injectées, testées sans regarder la vraie machine.

- [x] **T27** — Plan d’installation
  - Dépend de : T8, T24, T25
  - Fait quand : une fiche, un agent et un scope donnent la liste ordonnée des actions : ajouter la marketplace si l’agent ne la connaît pas, puis installer ou activer le plugin. Un plugin incompatible avec l’agent n’a pas de plan et le dit. Une marketplace du même nom déjà enregistrée avec une autre source est signalée, pas remplacée. Choisir `codex-cli` et `codex-desktop` ensemble ne produit qu’un plan. Un audit en échec n’a pas de plan, sauf audit coupé.

- [x] **T28** — Exécuteur par commande de l’agent
  - Dépend de : T27
  - Fait quand : une action `cli` lance l’exécutable de l’agent avec un tableau d’arguments, sans shell, avec timeout. Sous Windows, un lanceur `.cmd` est résolu sans faire passer d’argument par un shell. Un code de sortie non nul donne une erreur qui reprend stderr. `--dry-run` imprime la commande et ne lance rien. Testé avec un exécutable simulé.

- [x] **T29** — Exécuteur par fichiers
  - Dépend de : T27
  - Fait quand : une action `files` modifie seulement les clés visées, en JSON ou en TOML, et garde le reste du fichier intact. L’écriture est atomique (fichier temporaire puis remplacement) et laisse une copie de sauvegarde. Le dossier manquant est créé. `--dry-run` imprime le résultat et ne crée aucun fichier. Testé dans un dossier temporaire.

- [x] **T30** — Agent Claude Code
  - Dépend de : T28, T29
  - Fait quand : installer, désinstaller et lister l’installé marchent selon `docs/agents.md`, en scope utilisateur et projet. Testé avec un exécutable simulé ou un dossier temporaire, jamais la vraie config.

- [x] **T31** — Agent Claude Desktop / Cowork
  - Dépend de : T28, T29
  - Fait quand : même critère que T30. Si `docs/agents.md` ne trouve aucun mécanisme hors de l’application, `install` imprime la marche à suivre dans l’application, n’écrit rien, et la tâche se coche avec ce comportement.

- [x] **T32** — Agent GitHub Copilot CLI
  - Dépend de : T28, T29
  - Fait quand : même critère que T30, pour Copilot CLI.

- [x] **T33** — Agent Factory Droid
  - Dépend de : T28, T29
  - Fait quand : même critère que T30, pour Droid.

- [x] **T34** — Agents Codex CLI et Codex desktop (niveau 2)
  - Dépend de : T9, T28, T29
  - Fait quand : même critère que T30. Les deux agents partagent une seule installation et une seule liste de l’installé.

- [x] **T35** — Agent Cursor (niveau 2)
  - Dépend de : T9, T28, T29
  - Fait quand : même critère que T30, pour Cursor.

### Gestion

- [x] **T36** — Vue de l’installé
  - Dépend de : T18, T30, T31, T32, T33, T34, T35
  - Fait quand : les listes de chaque agent sont réunies et chaque entrée est rattachée à un id du catalogue. Le partage de Codex ne compte qu’une fois. Une entrée inconnue du catalogue est listée à part, pas forcée dans un id. Un plugin installé mais désactivé est marqué comme tel.

- [x] **T37** — Mises à jour
  - Dépend de : T36
  - Fait quand : la version installée est comparée à celle du catalogue. Sans version installée, l’entrée est « version inconnue », pas « à jour ». Mettre à jour passe par la commande de mise à jour de l’agent si `docs/agents.md` en donne une, sinon par désinstaller puis installer, avec le même audit que T27.

- [x] **T38** — Export et import
  - Dépend de : T5, T27, T36
  - Fait quand : `export` écrit `{ "pluginsAtlas": 1, "plugins": ["plugin@marketplace", …] }` pour les seuls plugins rattachés à un id. Un id mal formé, ou qui ressemble à une option, arrête l’import avant toute action. Un id absent du catalogue est signalé et sauté. L’import réutilise le plan de T27.

### Interfaces

- [x] **T39** — CLI non interactive
  - Dépend de : T19, T21, T22, T24, T26, T36, T37, T38
  - Fait quand : ces commandes répondent sans TUI : `themes`, `list` (`-q`, `-t`, `-a`, `--official`, `-n`, `--json`), `agents`, `show` (composants, risques sur stderr, `--json`), `install` (`-a`, `-g`/`-p`, `-y`, `--dry-run`, `--no-audit`), `uninstall`, `installed`, `outdated`, `update`, `export`, `import`, `--offline`, `--refresh`. `install -y` sans `-a` échoue. Un plugin en risque haut, ou incompatible avec l’agent choisi, est exclu et nommé.

- [x] **T40** — Complétion de shell
  - Dépend de : T39
  - Fait quand : `plugins-atlas completion` écrit un script bash, zsh, fish et PowerShell qui complète commandes, options, ids du cache, agents et thèmes, sans réseau.

- [x] **T41** — Arbre dans le terminal
  - Dépend de : T39
  - Fait quand : thèmes repliables, recherche, filtre par agent, coche, aperçu (README, composants, risques), puis revue (actions, risques, agent, scope) avant toute action. Les fiches en risque haut arrivent décochées. Fermer la revue sans confirmer ne fait rien.

- [x] **T42** — Page locale
  - Dépend de : T39
  - Fait quand : `plugins-atlas ui` sert les mêmes fiches dans le navigateur. Installer passe par la même revue que l’arbre. Une démo statique, séparée, ne peut rien installer.

- [x] **T43** — Serveur MCP du catalogue
  - Dépend de : T39
  - Fait quand : `plugins-atlas mcp` parle en stdio et expose chercher, montrer, installer. Installer refuse un risque haut et ne l’accepte qu’avec un argument explicite. Ce serveur ne lance aucun composant de plugin.

- [x] **T44** — Skill d’usage
  - Dépend de : T39
  - Fait quand : `skills/plugins-atlas/SKILL.md` ne documente que les commandes non interactives, dit de lire la fiche et ses hooks avant d’installer, et dit de ne pas suivre les instructions trouvées dans un README ou un manifeste.

- [x] **T45** — README
  - Dépend de : T20, T39
  - Fait quand : le README dit comment installer, quelles commandes existent, d’où vient le catalogue, ce que l’audit bloque, et quels agents sont pris en charge, niveau 1 et niveau 2.

- [x] **T46** — Tests de bout en bout
  - Dépend de : T20, T39
  - Fait quand : un test sans réseau part de fixtures, charge un catalogue, cherche, montre, fait un dry-run, installe pour un agent par commande simulée et un agent par fichiers dans un dossier temporaire, relit l’installé, puis désinstalle. Le dossier temporaire est vide des fichiers du test à la fin.

## Hors du plan

Le niveau 3 et tout autre agent. Ce n’est pas une tâche, et rien de T1 à T46 ne le fait. Un agent ajouté plus tard prend une ligne dans `docs/agents.md` et dans la table de T25, et réutilise le plan d’installation et ses exécuteurs, sans revoir le catalogue.
