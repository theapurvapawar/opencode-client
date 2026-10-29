# OpenCode Agent Client

Give a coding agent access to an existing OpenCode server through MCP or a JSON command-line interface. Discover projects, models and sessions; delegate work; inspect progress, tool results and diffs; answer authorized permission requests; and interrupt or redirect a task.

The same client works with Codex, Claude Code and other hosts that support local MCP servers. It does not start an OpenCode server or install model providers.

## Quick start

Requires Node.js 22 or later and an accessible OpenCode server implementing the [documented HTTP API](https://opencode.ai/docs/server/). The client detects the documented v1 API or the v2 API used by OpenCode 2.2.0. Both share the same MCP tools; pagination and question replies differ as described in [usage](docs/usage.md).

Before connecting, **the user must run `opencode serve` manually** (or confirm an existing server), provide the actual server URL, and supply the server password securely through `OPENCODE_SERVER_PASSWORD` or the host's secret mechanism. An installing agent must ask for these steps and wait for them; it must not start the server or assume it is unauthenticated. See [user-run server and password setup](INSTALL.md#user-run-server-and-password-setup). The password must reach the host-launched MCP process; a separate terminal export does not update an already-running app.

Once those steps are complete, clone this repository into a persistent directory, then:

```sh
npm ci
node bin/opencode-client.js doctor --url http://127.0.0.1:4096
node bin/opencode-client.js call projects --url http://127.0.0.1:4096
node bin/opencode-client.js call models '{"connectedOnly":true}'
node bin/opencode-client.js call sessions '{"allProjects":true}'
```

The default URL is `http://127.0.0.1:4096`. Set `OPENCODE_URL` or supply `--url` for a different host, port or API prefix. A web UI URL is not necessarily an API URL: `doctor` requires a JSON health response and reports HTML responses as a configuration error.

Install once across projects for your user account:

```sh
# Preview the app-wide configuration and skill.
node bin/opencode-client.js install --agent codex --scope user --url http://127.0.0.1:4096
# Apply the reviewed installation.
node bin/opencode-client.js install --agent codex --scope user --url http://127.0.0.1:4096 --apply
```

Use `--agent claude` for Claude Code. For project scope, use `--scope project --target /path/to/project` instead of `--scope user`; scope must always be supplied explicitly. Reload the host and trust the project/MCP server when requested. The installer records absolute executable paths, so keep this checkout and Node installation in place. No build step is required.

User scope registers both MCP and the skill in the host's user locations. Codex uses `~/.codex/config.toml` plus `~/.agents/skills`; Claude Code uses `~/.claude.json` plus `~/.claude/skills`. Existing project entries can override user settings; [migration instructions](INSTALL.md#moving-from-project-to-user-scope) explain how to remove duplicates safely. “App-wide” applies to the current account, not other users or cloud machines.

## Agent integrations

| Host | Integration | Installer behavior |
| --- | --- | --- |
| Codex | Project MCP config and agent skill | Writes `.codex/config.toml` and `.agents/skills/opencode/SKILL.md` |
| Claude Code | Project MCP config and skill; optional native plugin | Writes `.mcp.json` and `.claude/skills/opencode/SKILL.md` |
| Cursor | Project MCP config and skill | Writes `.cursor/mcp.json` and `.cursor/skills/opencode/SKILL.md` |
| VS Code / GitHub Copilot | Workspace MCP config and skill | Writes `.vscode/mcp.json` and `.github/skills/opencode/SKILL.md` |
| Gemini CLI | Project MCP config and skill | Writes `.gemini/settings.json` and `.gemini/skills/opencode/SKILL.md` |
| OpenCode | Local MCP config and skill | Writes `opencode.json` (or existing `opencode.jsonc`) and `.opencode/skills/opencode/SKILL.md` |
| Windsurf, Cline, Roo Code | MCP configuration generator | Generates config or merges into an explicitly selected settings file using `--config` |
| Other MCP hosts | Generic stdio MCP | `config --agent generic --scope user` prints configuration |
| Agents with shell access | JSON CLI and portable skill | Use `call`, `tools`, and `skills/opencode/SKILL.md` |

The paths in the table are for project scope. Codex, Claude Code, Cursor, Gemini and OpenCode also resolve native user paths with `--scope user`; VS Code and other profile-dependent hosts use an explicit absolute `--config` path. Adapters generate the hosts' documented formats. Automated protocol/configuration tests do not establish that every host/version has been tested interactively. See [installation](INSTALL.md) for setup, credentials, upgrades and agent-driven installation.

## Delegation workflow

Ask your host agent:

> Inspect the available OpenCode projects, connected models and running sessions. Delegate a review of the selected project, keep it read-only, and return the findings with the session ID. Supervise any permission requests rather than approving them automatically.

The agent should discover a server-side directory, choose a model, delegate a bounded task, save the returned IDs, then use `wait` and `inspect`. A task being accepted is not evidence that it completed. A connected model is not a guarantee of available credits or provider access.

`redirect` aborts the current execution and sends a new prompt. It does not roll back edits or provide token-level steering. The server retains the session history; this client keeps no separate task database.

## Tools

Discovery: `health`, `projects`, `models`, `agents`, `sessions`, `status`.

Supervision: `inspect`, `messages`, `wait`, `permissions`, `questions`.

Actions: `delegate`, `send`, `abort`, `redirect`, `permission_reply`, `question_reply`, `question_reject`.

MCP names have the `opencode_` prefix. The CLI accepts either name form. Run `node bin/opencode-client.js tools` for exact input schemas, or see [usage examples](docs/usage.md).

## Development and contributing

```sh
npm ci
npm test
npm run check
```

Tests use temporary files and local HTTP fixtures; they do not require a paid model or mutate your existing sessions. See [validation coverage](docs/validation.md), [architecture](docs/architecture.md), [contributing](CONTRIBUTING.md) and [security](SECURITY.md). This project is MIT licensed and is not affiliated with OpenCode, Anthropic or OpenAI.
