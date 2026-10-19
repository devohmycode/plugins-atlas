# plugins-atlas

Browse a catalog of public agent plugins and install them into the agents that can read them. A plugin is a declarative bundle (skills, commands, subagents, hooks, MCP servers) published in a marketplace. This is the plugins counterpart of [skills-atlas](https://github.com/devohmycode/skills-atlas) and mcp-atlas.

## Install

Node.js 20 or newer.

```bash
npm install
npm run build
node dist/cli.js --help
```

The package binary is `plugins-atlas`.

## Commands

`themes`, `list` (`-q`, `-t`, `-a`, `--official`, `-n`, `--json`), `agents`, `show` (components, risks on stderr, `--json`), `install` (`-a`, `-g` or `-p`, `-y`, `--dry-run`, `--no-audit`), `uninstall`, `installed`, `outdated`, `update`, `export`, `import`, `completion`, `browse`, `ui`, and `mcp`.

Without `-y`, `install`, `update` and `import` print the plan and change nothing. `install -y` without `-a` fails. `--dry-run` prints each command or file and changes nothing. `--offline` uses the cached or bundled snapshot and does not contact the network. `--refresh` checks for a newer snapshot now; otherwise a check waits 12 hours.

`browse` is the terminal tree and `ui` is the local page. Both show a review before anything changes. `mcp` speaks MCP on stdio and runs no plugin component.

## Agents

| Agent | Level | Install |
| --- | --- | --- |
| Claude Code | 1 | `claude plugin …`, user and project scopes |
| Claude Desktop / Cowork | 1 | none outside the app: the steps in the app are printed |
| GitHub Copilot CLI | 1 | `copilot plugin …` (user), `.github/copilot/settings.json` (project) |
| Factory Droid | 1 | `droid plugin …`, user and project scopes |
| Codex CLI and Codex desktop | 2 | `codex plugin …` (user), `.codex/config.toml` (project); both share one install |
| Cursor | 2 | a plugin folder in `~/.cursor/plugins/local/`, user scope |

A plugin installs only into the agents that read one of its manifests. Formats are not converted. Every path, command and file comes from [docs/agents.md](docs/agents.md), written from each vendor's documentation.

## Catalog

The snapshot is built from the official marketplaces of Anthropic, OpenAI (Codex) and Cursor, from GitHub code search for `.claude-plugin/marketplace.json` (with `GITHUB_TOKEN`), and from claude-plugins.dev. `npm run crawl` rebuilds `data/catalog.json.gz`.

Each plugin's files are read one by one from GitHub to list its components; nothing is cloned and nothing is run. Without a token only 40 repositories are read (`PLUGINS_ATLAS_REPO_LIMIT` changes it); a plugin left unread is read when it is shown or installed.

## Audit

A high risk blocks install unless `--no-audit` is set, or `audit: false` in `~/.config/plugins-atlas/config.json`. High: a hook or MCP server that pipes a download into a shell (`curl | sh`), runs `npx -y` or `uvx` without a version, reads `~/.ssh` or `~/.aws`, or names in its command a host that is neither the repository nor a known registry. Medium: every command hook, a remote MCP server on such a host, a source pinned by neither `ref` nor `sha`, a credential-like variable name. A plugin whose files could not be read is unaudited, not failed, and is not installed.

## License

MIT.
