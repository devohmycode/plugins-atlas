# Changelog

## 0.1.0 — 2026-10-19

First release. Browse public agent plugins and install them into the agents that can read them.

- **Seven agents, two levels.** Level 1, the `.claude-plugin` format: Claude Code, Claude Desktop / Cowork, GitHub Copilot CLI, Factory Droid. Level 2: Codex CLI and Codex desktop (one shared install), Cursor. Each install goes through the agent's own command (`claude plugin`, `copilot plugin`, `droid plugin`, `codex plugin`) or its files, as [docs/agents.md](docs/agents.md) records from each vendor's documentation. Claude Desktop has no outside mechanism: the steps in the app are printed and nothing is written.
- **A catalog of about 50,000 plugins** from the official marketplaces of Anthropic, OpenAI and Cursor, GitHub code search (with `GITHUB_TOKEN`) and claude-plugins.dev. `npm run crawl` rebuilds it; the CLI checks for a newer snapshot at most every 12 hours and works offline.
- **Nothing is cloned or run.** A plugin's files are read one by one from GitHub to list its skills, commands, subagents, hooks and MCP servers, and to tell which agents read its manifests. A plugin the crawl did not read is read when it is shown or installed.
- **Audit before installing.** A hook or MCP server that pipes a download into a shell, runs `npx -y` or `uvx` unpinned, reads `~/.ssh` or `~/.aws`, or reaches an unknown host is a high risk and is not installed without `--no-audit`. Every command hook and every unpinned source is flagged.
- **Commands:** `themes`, `list`, `agents`, `show`, `install`, `uninstall`, `installed`, `outdated`, `update`, `export`, `import`, `completion`. Without `-y`, changes are only planned; `--dry-run` prints each command and file.
- **Three more ways in:** `browse`, the terminal tree with preview and review; `ui`, a local page on 127.0.0.1 with a per-run token, plus a read-only demo in `demo/`; `mcp`, an MCP server on stdio to search, show and install from an agent.

Validation: 167 tests and TypeScript checks.
