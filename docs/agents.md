# Fiche technique des agents

Ce fichier décrit, pour chaque agent, ce que `plugins-atlas` peut lire et écrire. Le code ne s’appuie que sur ce qui est écrit ici.

Toutes les sources sont des pages de documentation officielle, lues le **2026-10-19**. Chaque section liste ses sources à la fin ; les renvois `[xx]` y pointent. « Non documenté » veut dire : la doc officielle ne le dit pas. Rien n’a été deviné.

Redirections constatées le 2026-10-19 : `docs.factory.ai` renvoie vers `docs.factory.com` ; `developers.openai.com/codex/plugins` renvoie vers `learn.chatgpt.com/docs/plugins`. Les deux domaines d’arrivée sont ceux des éditeurs.

---

## claude-code — Claude Code

### 1. Manifeste de plugin

- Chemin : `.claude-plugin/plugin.json`, à la racine du plugin. Il est facultatif [cc-man].
- Sans manifeste, l’entrée de marketplace tient lieu de manifeste [cc-mkt-ref].
- Champs principaux : `name` (requis, kebab-case, préfixe de tous les composants), `displayName`, `version`, `description`, `author` (`name` requis, `email`, `url`), `homepage`, `repository`, `license`, `keywords`, `defaultEnabled` (défaut `true`), `dependencies`, `userConfig` [cc-man].
- Champs de chemins : `skills`, `commands`, `agents`, `hooks`, `mcpServers`, `lspServers`, `outputStyles`, `workflows`, `experimental.themes`, `experimental.monitors` [cc-man].
- Le nom d’entrée de marketplace et le `name` du manifeste doivent être identiques ; sinon l’installation par le nom du manifeste échoue [cc-create-mkt].

### 2. Marketplace

- Chemin : `.claude-plugin/marketplace.json`. Le dossier qui contient `.claude-plugin/` est la racine ; les chemins relatifs partent de là [cc-mkt-ref].
- Premier niveau : `name`, `owner` (`name` requis, `email`, `url`) et `plugins` sont requis. Facultatifs : `$schema`, `description`, `version`, `metadata.description`, `metadata.version`, `metadata.pluginRoot`, `forceRemoveDeletedPlugins`, `allowCrossMarketplaceDependenciesOn`, `renames` [cc-mkt-ref].
- `name` : lettres, chiffres, `.`, `_`, `-`, commence par une lettre ou un chiffre, pas de `..`. Une longue liste de noms est réservée (`claude-plugins-official`, `anthropic-*`, `npm`, `github`, `claudeai-*`, etc.) [cc-mkt-ref].
- Entrée : `name` et `source` requis. Aussi `description`, `version`, `category`, `tags`, `strict` (défaut `true`), `relevance`, `dependencies`, `defaultEnabled`, `displayName`, `metadata`, `headers`, `headersHelper`, plus tout champ de `plugin.json` [cc-mkt-ref].
- Une clé inconnue est ignorée sans erreur [cc-mkt-ref].

Sources de plugin (`source` d’une entrée) [cc-mkt-ref] :

| Type | Forme | Champs |
| :- | :- | :- |
| Chemin relatif | `"./plugins/x"` (doit commencer par `./`, pas de `..`) ; nom nu si `metadata.pluginRoot` | — |
| `github` | `{ "source": "github", "repo": "owner/repo" }` | `repo`, `ref`, `sha` |
| `url` | `{ "source": "url", "url": "https://…/x.git" }` | `url`, `ref`, `sha` |
| `git-subdir` | `{ "source": "git-subdir", "url": "owner/repo", "path": "tools/x" }` | `url`, `path`, `ref`, `sha` |
| `npm` | `{ "source": "npm", "package": "@org/x" }` | `package`, `version`, `registry` |
| `archive` | zip en HTTPS | `url`, `sha256` |
| `command` | dossier imprimé par une commande locale | `command`, `timeout`, `mode` |

- `ref` : branche ou tag, défaut la branche par défaut. `sha` : SHA complet de 40 caractères en minuscules ; s’il est présent, il prime sur `ref` [cc-mkt-ref].
- Un chemin relatif ne se résout que si la marketplace vient d’une source `github`, `git`, `file` ou `directory` ; pas d’une source `url` [cc-mkt-ref].

### 3. Installation

Commande officielle : exécutable `claude`, sous-commande `plugin` (alias `plugins`). Codes de sortie : `0` succès, `1` échec [cc-cli].

| Action | Commande |
| :- | :- |
| Ajouter une marketplace | `claude plugin marketplace add <source> [--scope user\|project\|local] [--sparse <paths...>] [--json]` |
| Lister les marketplaces | `claude plugin marketplace list [--json]` |
| Rafraîchir une marketplace | `claude plugin marketplace update [name] [--json]` (`--json` exige un nom) |
| Retirer une marketplace | `claude plugin marketplace remove <name> [--scope …] [--json]` (désinstalle aussi ses plugins) |
| Installer | `claude plugin install <plugin>@<marketplace> [-s user\|project\|local] [--json] [-y]` |
| Ajouter et installer d’un coup | `claude plugin install <plugin> --marketplace <source>` (v2.1.292+) |
| Désinstaller | `claude plugin uninstall <plugin> [-s …] [--keep-data] [--json]` |
| Activer / désactiver | `claude plugin enable <plugin> [-s …] [--json]` / `claude plugin disable <plugin> [-s …] [--json]` |
| Mettre à jour | `claude plugin update <plugin> [-s user\|project\|local\|managed] [--json]` |
| Lister l’installé | `claude plugin list [--json] [--available]` |

Sources acceptées par `marketplace add` : `owner/repo`, `owner/repo#ref` ou `owner/repo@ref` (GitHub) ; `user@host:path` (git SSH) ; URL `http(s)` finissant par `.git` ou contenant `/_git/` (git) ; `https://github.com/owner/repo` (git) ; autre URL `http(s)` (fichier `marketplace.json` direct) ; chemin vers un dossier ou un fichier `.json` [cc-cli].

Non interactif :

- Les sous-commandes `claude plugin` se lancent hors session, depuis un script [cc-cli].
- Exception : un plugin à source `command` ou à `headersHelper` affiche la commande et demande `Run this command now? [y/N]`. Sans TTY et sans `-y` ni `--accept-command`, l’installation est refusée (code `1`). `-y` est ignoré quand la commande tourne dans une session Claude Code (outil Bash, hook) [cc-cli].
- `enable` sur un plugin déjà actif sort en `1` ; avec `--json`, `failureCode: "already_in_goal_state"` [cc-cli].
- `--json` : dernière ligne de stdout = un objet `{ command, outcome, message, … }` [cc-cli].

Par fichiers (alternative documentée) :

- `extraKnownMarketplaces` : objet `nom → { "source": { … }, "autoUpdate"?: bool }`. Types de source : `github` (`repo`, `ref`, `path`, `sparsePaths`), `git` (`url`, `ref`, `path`, `sparsePaths`), `url` (`url`, `headers`, `headersHelper`), `file` (`path`), `directory` (`path`), `settings` (catalogue en ligne) [cc-settings-ref] [cc-mkt-ref].
- `enabledPlugins` : objet `"plugin@marketplace" → true|false` [cc-settings-ref].
- Déclarer ne suffit pas toujours à installer. Un plugin à source externe activé seulement dans `.claude/settings.json` (projet) n’est pas téléchargé ; chacun doit lancer `claude plugin install … --scope project`. Il est téléchargé s’il est activé dans les réglages utilisateur, un `.claude/settings.local.json` non suivi par git, `--settings` ou les réglages managés [cc-loading].
- Les entrées `extraKnownMarketplaces` d’un dépôt ne comptent qu’après acceptation du dialogue de confiance du dossier [cc-settings-ref].

### 4. Scopes

`--scope` accepte `user`, `project`, `local` ; défaut `user`. `update` accepte aussi `managed` [cc-cli].

| Scope | Fichier écrit |
| :- | :- |
| `user` | `~/.claude/settings.json` |
| `project` | `.claude/settings.json` (commité) |
| `local` | `.claude/settings.local.json` |

Précédence : local > project > user ; les réglages managés priment sur tout [cc-install] [cc-loading].

### 5. Installé et activé

- Activé : `enabledPlugins` dans les fichiers de réglages ci-dessus, fusionnés clé par clé [cc-loading].
- Installé : `~/.claude/plugins/installed_plugins.json` (scope, `installPath`, version par installation) [cc-loading].
- Marketplaces connues : `~/.claude/plugins/known_marketplaces.json` (`source`, `installLocation`, `lastUpdated`, `autoUpdate`) [cc-loading].
- Fichiers : `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` ; clones de marketplace : `~/.claude/plugins/marketplaces/<name>/` ; données : `~/.claude/plugins/data/<plugin-id>/` [cc-loading].
- Lecture sans parser ces fichiers : `claude plugin list --json` (`id`, `version`, `scope`, `enabled`, `installPath`, …) et `claude plugin marketplace list --json` [cc-cli].
- `marketplace add` écrit la marketplace dans `extraKnownMarketplaces` des réglages utilisateur et sur disque [cc-loading].

### 6. Chemins

| Système | Dossier de config |
| :- | :- |
| macOS, Linux | `~/.claude` |
| Windows | `%USERPROFILE%\.claude` |

- `CLAUDE_CONFIG_DIR` déplace tout le dossier (réglages, historique, plugins). Il est ignoré dans les réglages projet et local [cc-settings] [cc-env].
- `CLAUDE_CODE_PLUGIN_CACHE_DIR` déplace seulement la racine des plugins (défaut `~/.claude/plugins`) [cc-env].
- Le terminal, les sessions locales de l’app de bureau (onglet Code) et l’extension VS Code lisent les mêmes fichiers [cc-install].

### 7. Composants

Skills (`skills/`), commandes (`commands/`), agents (`agents/`), hooks (`hooks/hooks.json`), serveurs MCP (`.mcp.json`), serveurs LSP (`.lsp.json`), styles de sortie (`output-styles/`), workflows (`workflows/`), thèmes (`themes/`), moniteurs (`monitors/monitors.json`), exécutables (`bin/`), `settings.json` [cc-man].

### Sources (lues le 2026-10-19)

- [cc-man] https://code.claude.com/docs/en/plugins-reference
- [cc-create-mkt] https://code.claude.com/docs/en/plugin-marketplaces
- [cc-mkt-ref] https://code.claude.com/docs/en/plugins/marketplace-reference
- [cc-cli] https://code.claude.com/docs/en/plugins/cli-reference
- [cc-install] https://code.claude.com/docs/en/plugins/install
- [cc-loading] https://code.claude.com/docs/en/plugins/loading
- [cc-settings-ref] https://code.claude.com/docs/en/settings-reference
- [cc-settings] https://code.claude.com/docs/en/settings
- [cc-env] https://code.claude.com/docs/en/env-vars

---

## claude-desktop — Claude Desktop / Cowork

### 1. Manifeste de plugin

- Même format que Claude Code : un plugin envoyé par **Upload plugin** doit contenir un seul `.claude-plugin/plugin.json` [cd-overview].
- Le format de marketplace est partagé avec Claude Code [cd-3p].

### 2. Marketplace

- `.claude-plugin/marketplace.json`, même schéma que Claude Code [cd-3p].
- Une marketplace ajoutée par l’utilisateur doit être un dépôt GitHub ou GitHub Enterprise, ou un dépôt public GitLab ou Bitbucket [cd-platform].
- Limites : 25 marketplaces ajoutées par compte et par organisation ; 500 plugins par marketplace ; 200 Mo et 5 000 fichiers par plugin [cd-cowork].
- Côté administrateur (déploiement 3P), un plugin dont la `source` pointe vers un autre dépôt n’est ni récupéré ni installé ; seules les sources relatives (git) ou `archive` de même origine (HTTPS) passent [cd-3p].

### 3. Installation

- Dans l’application uniquement : **Customize > Plugins**, puis **Discover**, **Add > Add marketplace** ou **Add > Upload plugin** (`.zip` ou `.plugin`) [cd-overview] [cd-support].
- Désinstaller : **Remove** ; désactiver : **Disable plugin** ; mettre à jour : **Check for updates** ou **Sync automatically** sur la marketplace [cd-overview] [cd-cowork].
- L’installation est rattachée au **compte** claude.ai, pas à la machine [cd-platform] [cd-support].

**Mécanisme hors de l’application pour un utilisateur : aucun mécanisme externe documenté.** Aucune commande ni aucun fichier local n’est documenté pour ajouter une marketplace ou installer un plugin dans Chat ou Cowork.

Deux cas voisins, à ne pas confondre :

- Les plugins installés avec `claude plugin install` restent sur la machine et ne remontent pas au compte. Le sens inverse existe : un plugin du compte arrive dans Claude Code comme `<name>@synced` [cd-platform] [cc-install].
- Claude Desktop en mode tiers (3P, fournisseur de modèle propre) : l’administrateur déclare les marketplaces dans la clé `allowedPluginMarketplaces` (profil MDM, fichier de configuration local ou serveur bootstrap) ou dépose des plugins dans un dossier système `org-plugins/` [cd-3p]. C’est un mécanisme d’administration, propre au mode 3P.

Détails 3P, pour mémoire [cd-3p] [cd-3p-config] :

- Entrée `allowedPluginMarketplaces` : `source` (`github` + `repo`, `git` + `url`, `url` + `url`), `ref`, `path`, `manifestSha256`, `expectedName`, `credentialKind`, `credentialHelper`, `installationPreference` (`available`, `auto_install`, `required`). `auto_install` et `required` exigent un `ref` de 40 caractères (git) ou `manifestSha256` (url).
- Dossier `org-plugins/` : macOS `/Library/Application Support/Claude/org-plugins/`, Windows `C:\Program Files\Claude\org-plugins\`, Linux non documenté. Un sous-dossier par plugin, avec `.claude-plugin/plugin.json`.
- Configuration locale 3P : macOS `~/Library/Application Support/Claude-3p/configLibrary/`, Windows `%LOCALAPPDATA%\Claude-3p\configLibrary\`, Linux `~/.config/Claude-3p/configLibrary/`. Configuration managée : plist `/Library/Managed Preferences/<user>/com.anthropic.claudefordesktop.plist`, registre `HKLM\SOFTWARE\Policies\Claude` ou `HKCU\…`, fichier `/etc/claude-desktop/managed-settings.json`.

### 4. Scopes

- Compte, pour l’organisation courante. Pas de scope projet ni local [cd-platform].
- Les organisations Team/Enterprise peuvent rendre un plugin **Installed by default** ou **Required** [cd-overview].

### 5. Installé et activé

Visible dans **Customize > Plugins** ; stocké côté compte. Aucun fichier local documenté [cd-platform].

### 6. Chemins

Aucun dossier de config utilisateur documenté pour les plugins (hors mode 3P, ci-dessus). Variable d’environnement : non documenté.

### 7. Composants [cd-platform]

| Composant | Chat | Cowork |
| :- | :- | :- |
| Skills | chargés | chargés |
| Commandes | chargées comme skills | chargées (`/plugin-name:command`) |
| Agents | ignorés | chargés |
| Hooks | ignorés | chargés |
| MCP distant (`http`/`sse`) | via l’onglet Connectors | chargé, à connecter |
| MCP local (commande, `.mcpb`) | ignoré | chargé si la session tourne sur l’ordinateur |
| `bin/` | refuse le plugin | refuse le plugin |
| LSP, styles, thèmes, `settings` | ignorés | ignorés |

### Sources (lues le 2026-10-19)

- [cd-support] https://support.claude.com/en/articles/13837440-use-plugins-in-claude
- [cd-overview] https://claude.com/docs/plugins/overview
- [cd-platform] https://claude.com/docs/plugins/platform-support
- [cd-cowork] https://claude.com/docs/cowork/guide/plugins
- [cd-3p] https://claude.com/docs/third-party/claude-desktop/extensions
- [cd-3p-config] https://claude.com/docs/third-party/claude-desktop/configuration
- [cc-install] https://code.claude.com/docs/en/plugins/install

---

## copilot-cli — GitHub Copilot CLI

### 1. Manifestes de plugin

Deux formats [gh-ref] [gh-about] :

- **Agent Plugins 1.0/1.1** : `plugin.json` à la racine, avec `$schema` égal à `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json` ou `…/1.1.0/…`. Champs permis : `$schema`, `name` (requis), `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`, `extensions`. Composants Copilot sous `com.github.copilot/`.
- **Legacy** : premier trouvé parmi `.plugin/plugin.json`, `plugin.json`, `.github/plugin/plugin.json`, `.claude-plugin/plugin.json`. Champ requis `name` (kebab-case, 64 caractères max). Facultatifs : `description`, `version`, `author`, `homepage`, `repository`, `license`, `keywords`, `category`, `tags`, et les chemins `agents`, `skills`, `commands`, `hooks`, `extensions`, `mcpServers`, `lspServers`.

Le chemin GitHub est `.github/plugin/plugin.json`, pas `.github/plugin.json` [gh-ref].

### 2. Marketplace

- Premier trouvé parmi `marketplace.json`, `.plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.claude-plugin/marketplace.json` [gh-ref].
- Premier niveau : `name` (requis, kebab-case, 64 max), `owner` (requis, `{ name, email? }`), `plugins` (requis), `metadata` (`{ description?, version?, pluginRoot? }`) [gh-ref].
- Entrée : `name`, `source` requis ; `description`, `version`, `author`, `homepage`, `repository`, `license`, `keywords`, `category`, `tags`, `commands`, `agents`, `skills`, `hooks`, `mcpServers`, `lspServers`, `strict` [gh-ref].
- Sources de plugin : chemin relatif à la racine du dépôt (`./` facultatif) ; `{ "source": "github", "repo", "ref"?, "sha"?, "path"? }` ; `{ "source": "url", … }` avec `ref` ou `sha`. `sha` = 40 caractères [gh-ref].
- Les champs de la source `url` autres que `sha` : non documenté (seul l’exemple `github` est détaillé).
- Le nom de la marketplace dans `marketplace.json` devient sa clé d’enregistrement ; aucun nom local ne peut être choisi [gh-ref].

### 3. Installation

Commande officielle : exécutable `copilot`, sous-commande `plugin` (alias hérité `plugins`) [gh-ref].

| Action | Commande |
| :- | :- |
| Ajouter une marketplace | `copilot plugin marketplace add SOURCE` (`owner/repo`, `owner/repo#ref`, URL, chemin local) |
| Lister les marketplaces | `copilot plugin marketplace list [--json]` |
| Parcourir une marketplace | `copilot plugin marketplace browse NAME [--json]` |
| Rafraîchir | `copilot plugin marketplace update [NAME]` (alias `refresh`) |
| Retirer | `copilot plugin marketplace remove NAME [--force]` (refusé s’il reste des plugins, sauf `--force`) |
| Installer | `copilot plugin install PLUGIN@MARKETPLACE` (alias `add`) ; aussi `OWNER/REPO`, `OWNER/REPO:PATH`, URL git, chemin local |
| Désinstaller | `copilot plugin uninstall NAME` (alias `remove`, `rm`) |
| Activer / désactiver | `copilot plugin enable NAME` / `copilot plugin disable NAME` |
| Mettre à jour | `copilot plugin update NAME` ou `copilot plugin update --all` |
| Lister | `copilot plugin list [--json]` ; ligne JSON : `{ name, marketplace?, version?, enabled, source, installedFrom? }` |

- `--config-dir` est déprécié ; utiliser `COPILOT_HOME` [gh-ref].
- Non interactif : non documenté explicitement. Aucune invite n’est décrite pour ces commandes. En cas d’échec d’authentification HTTPS, la CLI réessaie avec le jeton GitHub connecté [gh-ref].
- `enable`/`disable` est refusé si l’activation est décidée par le `enabledPlugins` du dépôt courant, ou par une politique managée [gh-ref].

Par fichiers :

- `enabledPlugins` : `Record<string, boolean>`, « auto-installation déclarative » ; clés = spécifications de plugin [gh-config].
- `extraKnownMarketplaces` : `Record<string, {...}>` ; `source` requise, de type `"directory"`, `"git"` ou `"github"` ; `autoUpdate: true` facultatif (honoré seulement en réglages utilisateur ou managés) [gh-config].
- La forme exacte des champs de chaque `source` dans `extraKnownMarketplaces` : non documenté.

### 4. Scopes [gh-config]

| Scope | Fichier |
| :- | :- |
| Utilisateur | `~/.copilot/settings.json` |
| Dépôt | `.github/copilot/settings.json` (commité) |
| Local | `.github/copilot/settings.local.json` (à ignorer dans git) |

- Ordre (le dernier gagne) : défauts, MDM, utilisateur, dépôt, local, variables d’environnement, options.
- La CLI lit aussi `enabledPlugins` et `extraKnownMarketplaces` dans `.claude/settings.json` et `.claude/settings.local.json`.
- Un plugin activé seulement par le `enabledPlugins` d’un dépôt s’installe et s’active dans ce dépôt, et reste désactivé ailleurs.
- `copilot plugin install` n’a pas d’option de scope documentée : l’installation par commande est utilisateur. Le scope dépôt ou local passe par les fichiers.

### 5. Installé et activé

- Fichiers installés : `~/.copilot/installed-plugins/MARKETPLACE/PLUGIN-NAME` (marketplace) et `~/.copilot/installed-plugins/_direct/SOURCE-ID/` (installation directe) [gh-ref] [gh-config].
- Métadonnées d’installation : `~/.copilot/config.json`, état interne géré par la CLI, à ne pas éditer [gh-config].
- Activé : `enabledPlugins` dans les fichiers de réglages. Le fichier exact où `enable`/`disable` écrit : non documenté (« persiste dans la configuration ») [gh-ref].
- Lecture recommandée : `copilot plugin list --json`.

### 6. Chemins [gh-config]

| Système | Config | Cache des marketplaces |
| :- | :- | :- |
| macOS | `~/.copilot` | `~/Library/Caches/copilot` |
| Linux | `~/.copilot` | `$XDG_CACHE_HOME/copilot` ou `~/.cache/copilot` |
| Windows | `C:\Users\<user>\.copilot` | `%LOCALAPPDATA%/copilot` |

- `COPILOT_HOME` remplace tout `~/.copilot`.
- `COPILOT_CACHE_HOME` déplace le cache.
- Réglages managés Windows : `HKLM\SOFTWARE\Policies\GitHubCopilot` ou `%ProgramFiles%\GitHubCopilot\managed-settings.json`.

### 7. Composants [gh-ref] [gh-about]

Agents (`agents/*.agent.md`), skills (`skills/<n>/SKILL.md`), commandes, hooks (`hooks.json` ou `hooks/hooks.json`), serveurs MCP (`.mcp.json`, `.github/mcp.json` ; `mcp.json` pour Agent Plugins), serveurs LSP (`lsp.json`, `.github/lsp.json`), règles (Agent Plugins, `com.github.copilot/rules/`), extensions.

### Sources (lues le 2026-10-19)

- [gh-ref] https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference
- [gh-config] https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference
- [gh-about] https://docs.github.com/en/copilot/concepts/agents/about-plugins
- [gh-find] https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-finding-installing

---

## droid — Factory Droid

### 1. Manifestes de plugin [fa-plugins]

- Natif : `.factory-plugin/plugin.json`.
- Compatible Claude Code : `.claude-plugin/plugin.json`. Droid traduit à la copie dans son cache : `.claude-plugin/` → `.factory-plugin/`, `agents/` → `droids/`, `.mcp.json` → `mcp.json`.
- Champs : `name`, `description`, `version`, `author`, `homepage`, `repository`, `license`, `keywords`. Droid ne lit pas ces champs : l’identité vient de l’entrée de marketplace.

### 2. Marketplace [fa-plugins]

- Droid lit `.factory-plugin/marketplace.json`, sinon `.claude-plugin/marketplace.json`.
- Premier niveau : `name` (requis), `description`, `owner`. Le nom enregistré vient de la source ou de la clé `extraKnownMarketplaces`.
- Entrée : `name`, `source` requis ; `description`, `category`, `homepage`, `tags`.

| Source de plugin | Forme | Épinglage |
| :- | :- | :- |
| Chemin relatif | `"./plugin-one"` (pas de chemin absolu ni de sortie du dossier) | via la marketplace |
| `url` | `{ "source": "url", "url": "https://github.com/org/plugin.git" }` | `ref` ou `sha` (40 caractères) |
| `git-subdir` | `{ "source": "git-subdir", "url": "…", "path": "plugins/foo" }` | `ref` ou `sha` |
| `npm` | `{ "source": "npm", "package": "@org/plugin", "version": "^2.0.0" }` | `version` ; aussi `registry`, `authTokenEnvVar` |

- La source `github` n’enregistre qu’une marketplace ; elle n’est pas une source de plugin.
- Avec un nom dérivé d’une source épinglée, Droid ajoute l’épingle au nom : `your-org/plugins#v1.2.0` s’enregistre `plugins@v1.2.0`.

### 3. Installation [fa-plugins]

Commande officielle : exécutable `droid`.

| Action | Commande |
| :- | :- |
| Ajouter une marketplace | `droid plugin marketplace add <source>` (`owner/repo`, URL GitHub, autre URL git, chemin local ; `#<ref>` ou `@<sha-40>`) |
| Lister | `droid plugin marketplace list` |
| Rafraîchir | `droid plugin marketplace update [name]` |
| Retirer | `droid plugin marketplace remove <name>` |
| Installer | `droid plugin install <plugin@marketplace> --scope user\|project` |
| Lister l’installé | `droid plugin list --scope user` |
| Mettre à jour | `droid plugin update [plugin@marketplace] --scope project` |
| Désinstaller | `droid plugin uninstall <plugin@marketplace> --scope project` |

- Pas de commande `enable`/`disable` : l’activation est la clé `enabledPlugins` des réglages.
- La doc présente ces commandes « pour les scripts et l’intégration » ; une éventuelle invite : non documenté.
- `marketplace add npm:<package>` est refusé.
- Sortie JSON : non documenté.

Par fichiers [fa-plugins] [fa-ent] :

- `extraKnownMarketplaces` : `nom → { "source": { … } }`. Types vus dans la doc : `github` (`repo`, `ref`), `git-subdir` (`url`, `path` requis ; `ref`, `sha`), `local` (`path`).
- `enabledPlugins` : `"plugin@marketplace" → true|false`. Un `true` installe le plugin au démarrage, une fois sa marketplace disponible [fa-hier].
- Le scope d’installation suit le fichier qui déclare : réglages managés → scope `org`, utilisateur → `user`, projet → `project`.

### 4. Scopes [fa-plugins] [fa-hier]

| Scope | Fichier |
| :- | :- |
| `user` | `~/.factory/settings.json` (+ `~/.factory/settings.local.json`) |
| `project` | `<git-root>/.factory/settings.json` (+ `settings.local.json`) |
| `org` | réglages managés ; pas installable par l’utilisateur |

- Il existe aussi un niveau « dossier » (`.factory/` d’un sous-dossier de monorepo).
- Un scope `local` pour `droid plugin install` : non documenté.
- Les `enabledPlugins` d’org, de projet et d’utilisateur se cumulent, sauf `strictEnabledPlugins` [fa-hier].

### 5. Installé et activé

- Activé : `enabledPlugins` dans les `settings.json` ci-dessus [fa-plugins].
- Installé : `droid plugin list --scope …` [fa-plugins].
- Fichier qui enregistre les installations et chemin du cache : non documenté.

### 6. Chemins [fa-settings]

| Système | Réglages utilisateur |
| :- | :- |
| macOS, Linux | `~/.factory/settings.json` |
| Windows | `%USERPROFILE%\.factory\settings.json` |

Variable d’environnement qui déplace `~/.factory` : non documenté.

### 7. Composants [fa-plugins]

Skills (`skills/<n>/SKILL.md`), commandes (`commands/`), droids ou sous-agents (`droids/`), styles de sortie (`output-styles/`), hooks (`hooks/hooks.json`), serveurs MCP (`mcp.json`).

### Sources (lues le 2026-10-19)

- [fa-plugins] https://docs.factory.com/harness/plugins
- [fa-ent] https://docs.factory.com/enterprise/internal-plugin-marketplaces
- [fa-hier] https://docs.factory.com/enterprise/hierarchical-settings-and-org-control
- [fa-settings] https://docs.factory.com/droid-cli/settings

---

## codex-cli et codex-desktop — OpenAI Codex

« Codex desktop » est Codex dans l’application de bureau ChatGPT [cx-plugins].

**Fichiers partagés : oui.** Les réglages de plugins des marketplaces locales s’appliquent à Codex CLI et à Codex dans l’app de bureau. Les deux lisent `~/.codex/config.toml` et installent dans `~/.codex/plugins/cache/` [cx-build]. La CLI et l’extension IDE partagent les mêmes couches de configuration [cx-config-basic].

### 1. Manifestes de plugin [cx-build]

- Portable (Agent Plugins) : `plugin.json` à la racine, avec `$schema` `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`. Champs : `name` (kebab-case, identifiant et espace de noms), `version`, `description`, `author` (`name`, `email`, `url`), `homepage`, `repository`, `license`, `keywords`.
- Réglages propres à OpenAI : objet `extensions.com.openai` du `plugin.json` racine (`apps`, `hooks`, `interface`, `onboardingSkill`).
- Surcouche facultative : `.codex-plugin/plugin.json`, utilisée seulement si `extensions.com.openai` est absent ; les deux ne fusionnent pas.
- OpenAI accepte aussi « des manifestes hérités et compatibles Claude ». Leurs chemins exacts : non documenté.

### 2. Marketplace [cx-build]

Emplacements lus :

- dépôt : `$REPO_ROOT/.agents/plugins/marketplace.json` ;
- dépôt, compatibilité : `$REPO_ROOT/.claude-plugin/marketplace.json` ;
- personnel : `~/.agents/plugins/marketplace.json`.

Schéma :

- Premier niveau : `name`, `interface.displayName`, `plugins`. Champ `owner` : non documenté.
- Entrée : `name`, `source`, `policy.installation` (`AVAILABLE`, `INSTALLED_BY_DEFAULT`, `NOT_AVAILABLE`), `policy.authentication` (`ON_INSTALL` ou à la première utilisation), `category`. La doc demande de toujours fournir `policy.installation`, `policy.authentication` et `category`.

| Source de plugin | Forme |
| :- | :- |
| locale | `{ "source": "local", "path": "./plugins/x" }` ou chaîne `"./plugins/x"` (relatif à la racine de la marketplace, commence par `./`) |
| `url` | dépôt git, plugin à la racine ; `ref` ou `sha` |
| `git-subdir` | `{ "source": "git-subdir", "url": "…", "path": "./plugins/x", "ref": "main" }` ; `ref` ou `sha` |
| `npm` | `{ "source": "npm", "package": "@x/y", "version": "^1.2.0", "registry": "https://…" }` |

- Une source `github` pour un plugin : non documenté.
- Une entrée dont la source ne se résout pas est sautée, sans faire échouer la marketplace.

### 3. Installation

Commande officielle : exécutable `codex` [cx-cli-ref].

| Action | Commande |
| :- | :- |
| Ajouter une marketplace | `codex plugin marketplace add <source> [--ref REF] [--sparse PATH] [--json]` (`owner/repo`, `owner/repo@ref`, URL git HTTP(S) ou SSH, dossier local) |
| Lister | `codex plugin marketplace list [--json]` |
| Rafraîchir | `codex plugin marketplace upgrade [marketplace-name] [--json]` (marketplaces git) |
| Retirer | `codex plugin marketplace remove <marketplace-name> [--json]` |
| Installer | `codex plugin add <plugin[@marketplace]> [--marketplace, -m NAME] [--json]` |
| Lister l’installé | `codex plugin list [--marketplace, -m NAME] [--available --json] [--json]` |
| Désinstaller | `codex plugin remove <plugin> [--marketplace, -m NAME] [--json]` (« retire de la config locale et du cache ») |
| Activer / désactiver | pas de commande ; clé `plugins."<plugin>@<marketplace>".enabled`, ou touche Espace dans `/plugins` |
| Mettre à jour un plugin | non documenté (seul `marketplace upgrade` existe) |

- `--json` est décrit comme « adapté à l’automatisation » [cx-cli-ref].
- Sorties JSON : `add` → `pluginId`, `name`, `marketplaceName`, `version`, `installedPath`, `authPolicy` ; `list` → tableaux `installed` et `available` [cx-cli-ref].
- Une invite éventuelle : non documenté.
- Le guide du développeur conseille l’app de bureau pour installer et tester un plugin local [cx-build].
- Dans l’app : onglet **Plugins** ; lien `codex://plugins/install/<plugin-name>?marketplace=<marketplace-name>` [cx-commands].

Par fichiers (`config.toml`) [cx-config-ref] [cx-build] :

```toml
[marketplaces.ma-marketplace]
source_type = "git"            # ou "local"
source = "https://github.com/org/repo.git"   # chemin absolu pour "local"
ref = "main"                   # facultatif
sparse_paths = [".agents/plugins", "plugins"] # facultatif

[plugins."mon-plugin@ma-marketplace"]
enabled = true
```

- Le dossier d’une source `local` contient `.agents/plugins/marketplace.json` [cx-config-ref].
- Pour une marketplace locale, déposer le dossier du plugin et l’entrée dans `marketplace.json` suffit ; il faut ensuite redémarrer l’app de bureau [cx-build].
- Un rafraîchissement de marketplace peut installer les plugins configurés, même avec `enabled = false` [cx-build].

### 4. Scopes [cx-build] [cx-config-basic]

| Scope | Fichier |
| :- | :- |
| Utilisateur | `~/.codex/config.toml` ; marketplace personnelle `~/.agents/plugins/marketplace.json` |
| Projet | `.codex/config.toml` du dépôt (projet de confiance seulement) ; marketplace `.agents/plugins/marketplace.json` |

- Précédence : projet > profil > utilisateur, sous réserve des exigences managées.
- Le navigateur de plugins enregistre les choix utilisateur dans `~/.codex/config.toml`.
- Une option de scope pour `codex plugin add` : non documenté.
- Un scope « local » distinct : non documenté.

### 5. Installé et activé [cx-build] [cx-cli-ref]

- Installé : `~/.codex/plugins/cache/$MARKETPLACE_NAME/$PLUGIN_NAME/$VERSION/` ; `$VERSION` vaut `local` pour un plugin local.
- Activé : `plugins."<plugin>@<marketplace>".enabled` dans la config fusionnée.
- Lecture : `codex plugin list --json` (`installed`, `enabled`, …) et `codex plugin marketplace list --json`.

### 6. Chemins

| Système | Dossier |
| :- | :- |
| macOS, Linux | `~/.codex` |
| Windows | `C:\Users\<user>\.codex` (exemple de la doc de déploiement Windows) [cx-win] |

- `CODEX_HOME` déplace la racine de l’état Codex (config, auth, logs, skills) ; le dossier doit exister [cx-env].
- `~/.agents` sous Windows et variable qui le déplace : non documenté.
- L’app Windows est le paquet `OpenAI.Codex` (MSIX/Appx) [cx-win].

### 7. Composants [cx-plugins] [cx-build]

Skills (`skills/`), serveurs MCP (`mcp.json`), hooks de cycle de vie (déclarés dans `extensions.com.openai.hooks` ; installation manuelle dans Codex desktop), extensions de navigateur, `apps` (`.app.json`, correspondances de serveurs MCP enregistrés). Agents et commandes : non documentés comme composants de plugin.

### Sources (lues le 2026-10-19)

- [cx-plugins] https://learn.chatgpt.com/docs/plugins (cible de https://developers.openai.com/codex/plugins)
- [cx-build] https://developers.openai.com/plugins/build/plugins
- [cx-cli-ref] https://learn.chatgpt.com/docs/developer-commands?surface=cli
- [cx-config-ref] https://learn.chatgpt.com/docs/config-file/config-reference
- [cx-config-basic] https://learn.chatgpt.com/docs/config-file/config-basic
- [cx-env] https://learn.chatgpt.com/docs/config-file/environment-variables
- [cx-commands] https://learn.chatgpt.com/docs/reference/commands
- [cx-win] https://learn.chatgpt.com/docs/enterprise/windows-deployment

---

## cursor — Cursor

### 1. Manifestes de plugin [cu-ref]

- Agent Plugins : `plugin.json` à la racine (skills, MCP).
- Cursor Plugins : `.cursor-plugin/plugin.json`. Seul `name` est requis (minuscules, kebab-case, points permis). Facultatifs : `description`, `version`, `author` (`name`, `email`), `homepage`, `repository`, `license`, `keywords`, `logo`, `rules`, `agents`, `skills`, `commands`, `hooks`, `mcpServers`, `variables`.
- Un chemin donné dans le manifeste remplace la découverte par dossier pour ce composant.
- Lecture de `.claude-plugin/plugin.json` : non documenté. Cursor développe seulement `${CLAUDE_PLUGIN_ROOT}` dans `mcp.json`.

### 2. Marketplace [cu-ref]

- Chemin : `.cursor-plugin/marketplace.json` à la racine du dépôt.
- Premier niveau : `name` (requis, kebab-case), `owner` (requis, `name` requis, `email`), `plugins` (requis, fichier ≤ 10 Mo), `metadata` (`description`, `version`, `pluginRoot`).
- Entrée : `name` (requis), `source` (chaîne = chemin du dossier, ou objet avec `path` et options), `description`, `version`, `author`, `homepage`, `repository`, `license`, `keywords`, `logo`, `category`, `tags`, chemins de composants, `variables`.
- Résolution de `"source": "my-plugin"` : lecture de `my-plugin/.cursor-plugin/plugin.json`, fusion avec l’entrée (le manifeste prime).
- Sources distantes (github, url git, `ref`, `sha`) : non documenté.

### 3. Installation [cu-plugins] [cu-cli]

- Dans l’éditeur : **Customize**, choisir le plugin, **Install**, puis scope projet ou utilisateur.
- Marketplaces d’équipe : **Dashboard → Plugins & MCPs** (offres Teams et Enterprise). Import depuis GitHub, GitLab, Bitbucket ou Azure DevOps.
- CLI `agent` : `/plugin [subcommand]` dans une session interactive (« gérer plugins et marketplaces »). Sous-commandes : non documenté. `--plugin-dir <path>` charge un dossier local pour une session.
- Commande shell d’installation non interactive : aucune documentée.
- Par fichiers : copier le plugin dans `~/.cursor/plugins/local/<nom>/`, puis redémarrer ou lancer **Developer: Reload Window**. Prévu pour tester avant publication. Sur Teams/Enterprise, réglage **Allow Local Plugin Imports**, désactivé par défaut sur Enterprise. Un plugin de marketplace de même nom prime.
- Les liens symboliques dans `~/.cursor/plugins/local` ne sont suivis que vers l’intérieur de ce dossier.
- Désinstaller, activer, mettre à jour : via **Customize** et le tableau de bord (**Refresh**, **Enable Auto Refresh**). Équivalent en fichiers : non documenté.

### 4. Scopes [cu-plugins]

Utilisateur, projet (workspace) et équipe. Le filtre de **Customize** propose user, workspace et team. Fichiers correspondants : non documenté.

### 5. Installé et activé

Visible dans **Customize**. Fichiers qui enregistrent l’installé et l’activé : non documenté.

### 6. Chemins

- `~/.cursor/plugins/local` (plugins locaux), `~/.cursor/skills/` (skills personnels) [cu-plugins].
- Équivalent Windows de `~` : non documenté.
- Variable d’environnement qui déplace `~/.cursor` : non documenté.

### 7. Composants [cu-ref]

Règles (`rules/`, `.mdc`), skills (`skills/`, ou `SKILL.md` racine), agents (`agents/`), commandes (`commands/`), hooks (`hooks/hooks.json`), serveurs MCP (`mcp.json`), variables. Agent Plugins : skills et MCP seulement.

### Sources (lues le 2026-10-19)

- [cu-plugins] https://cursor.com/docs/plugins
- [cu-ref] https://cursor.com/docs/reference/plugins
- [cu-cli] https://cursor.com/docs/cli/reference/slash-commands et https://cursor.com/docs/cli/reference/parameters

---

## Marketplaces officielles

Lues le 2026-10-19, fichier par fichier sur GitHub. Ce sont les sources T11 et T13.

| Origine | Dépôt | Fichier | Éditeur |
| :- | :- | :- | :- |
| `official` | `anthropics/claude-plugins-official` | `.claude-plugin/marketplace.json` | Anthropic (nom réservé, [cc-mkt-ref]) |
| `codex` | `openai/plugins` | `.agents/plugins/marketplace.json` | OpenAI (`openai-curated`) |
| `cursor` | `cursor/plugins` | `.cursor-plugin/marketplace.json` | Cursor (`cursor-plugins`) |

Les dépôts de Codex et de Cursor ne sont pas nommés dans la doc officielle : ils appartiennent aux organisations GitHub des éditeurs.

---

## Récapitulatif

| Agent | Manifestes lus | Mécanisme | Scopes |
| :- | :- | :- | :- |
| `claude-code` | `.claude-plugin/plugin.json` | `cli` (`claude plugin …`) ; `files` possible (`enabledPlugins`, `extraKnownMarketplaces`) | user, project, local |
| `claude-desktop` | `.claude-plugin/plugin.json` | aucun mécanisme externe documenté (application ; admin 3P à part) | compte |
| `copilot-cli` | `plugin.json` racine (Agent Plugins) ; legacy `.plugin/plugin.json`, `plugin.json`, `.github/plugin/plugin.json`, `.claude-plugin/plugin.json` | `cli` (`copilot plugin …`) ; `files` pour dépôt et local | utilisateur, dépôt, local |
| `droid` | `.factory-plugin/plugin.json`, `.claude-plugin/plugin.json` | `cli` (`droid plugin …`) ; activation en `files` (`enabledPlugins`) | user, project (org en managé) |
| `codex-cli` | `plugin.json` racine, `.codex-plugin/plugin.json` | `cli` (`codex plugin …`) ; activation en `files` (`config.toml`) | utilisateur, projet |
| `codex-desktop` | idem `codex-cli` (mêmes fichiers) | `files` (marketplace locale + `config.toml`) ou la CLI `codex` partagée | utilisateur, projet |
| `cursor` | `plugin.json` racine, `.cursor-plugin/plugin.json` | `files` limité (`~/.cursor/plugins/local`), sinon application | utilisateur, projet, équipe |
