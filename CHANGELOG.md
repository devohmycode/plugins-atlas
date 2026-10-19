# Changelog

## Unreleased

- **A dist-tag, a wildcard or a range is not a version.** `npx -y pkg@latest`, `uvx pkg@latest`, `@next`, `@*`, `@^1`, `@1.x` or `==1.*` now count as unpinned (high), like a bare package name: they used to pass because of the `@` or `==`. The official plugin aws-serverless runs `uvx awslabs.aws-serverless-mcp-server@latest`. An exact version (`@1.2.3`, `==0.6.2`) still passes.

## 0.2.0 — 2026-10-19

- **The terminal wizard of mcp-atlas and skills-atlas.** `plugins-atlas` alone opens it: tree, scope, agents, review, then the tree again with the run's summary. Same logo (PLUGINS ATLAS, sky blue to pink), palette, step header, clickable key hints and mouse. Keys: `space`, `/`, `a`, `s`, `o`, `p`, `g`, `u`/`U`, `enter`, `q`. Installed plugins come first, ticked: unticking one uninstalls it, `u` updates it. The review audits what it installs: a high-risk plugin is left out unless kept with `space`. Changes are applied once the wizard has left the screen, so agent messages print below it.
- **Options of mcp-atlas `browse`:** `-t, --theme <ids...>`, `-q, --search`, `--official`, `-s, --sort`, `-a` (with `*`), `-g`/`-p`, `-y`, `--dry-run`, `--no-audit`, `--no-mouse`. What they leave open is asked. In a terminal, `install <ids>` without `-y` opens the wizard on those plugins, the tree skipped. `list -q` is now `--search` (`--query` still works) and takes `-s`. The tree no longer filters by agent: the review says which chosen agents read each plugin.
- **A remote MCP server on an unknown host is a medium risk, not a high one.** It runs nothing on the machine, so it no longer blocks the install: official plugins such as Adobe's install again. A URL to an unknown host inside a hook or a local server command stays high.

Validation: 190 tests and TypeScript checks.

## 0.1.0 — 2026-10-19

First release. Browse public agent plugins and install them into the agents that can read them.

- **Seven agents, two levels.** Level 1, the `.claude-plugin` format: Claude Code, Claude Desktop / Cowork, GitHub Copilot CLI, Factory Droid. Level 2: Codex CLI and Codex desktop (one shared install), Cursor. Each install goes through the agent's own command (`claude plugin`, `copilot plugin`, `droid plugin`, `codex plugin`) or its files, as [docs/agents.md](docs/agents.md) records from each vendor's documentation. Claude Desktop has no outside mechanism: the steps in the app are printed and nothing is written.
- **A catalog of about 50,000 plugins** from the official marketplaces of Anthropic, OpenAI and Cursor, GitHub code search (with `GITHUB_TOKEN`) and claude-plugins.dev. `npm run crawl` rebuilds it; the CLI checks for a newer snapshot at most every 12 hours and works offline.
- **Nothing is cloned or run.** A plugin's files are read one by one from GitHub to list its skills, commands, subagents, hooks and MCP servers, and to tell which agents read its manifests. A plugin the crawl did not read is read when it is shown or installed.
- **Audit before installing.** A hook or MCP server that pipes a download into a shell, runs `npx -y` or `uvx` unpinned, reads `~/.ssh` or `~/.aws`, or reaches an unknown host is a high risk and is not installed without `--no-audit`. Every command hook and every unpinned source is flagged.
- **Commands:** `themes`, `list`, `agents`, `show`, `install`, `uninstall`, `installed`, `outdated`, `update`, `export`, `import`, `completion`. Without `-y`, changes are only planned; `--dry-run` prints each command and file.
- **Three more ways in:** `browse`, the terminal tree with preview and review; `ui`, a local page on 127.0.0.1 with a per-run token, plus a read-only demo in `demo/`; `mcp`, an MCP server on stdio to search, show and install from an agent.

Validation: 167 tests and TypeScript checks.
