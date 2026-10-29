# Installation

## Instructions for an installing agent

When a user asks you to install this client, perform the following work within that authorization. Do not replace an existing configuration file with a generated example.

1. Confirm Node.js 22+ is available. Use an existing checkout or clone the user-selected repository URL into a persistent directory. No public repository URL is assumed by this document; `OWNER/REPO` in examples is a placeholder.
2. Run `npm ci` in the checkout. There is no compilation step.
3. Resolve the intended host (`codex`, `claude`, `cursor`, `vscode`, `gemini`, `opencode`, or an explicit-file MCP host), installation scope and OpenCode API URL from the user's instructions or existing configuration. Use `--scope user` when the user asks for app-wide, global or all-project access for their account. Use `--scope project --target PROJECT` for a shared project installation. Both `install` and `config` require an explicit scope; if the user has not chosen one, ask before proceeding. Never infer scope from the working directory or `--target`. Ask only for information that cannot be resolved. Never embed passwords in URLs or tracked files.
4. Run `node bin/opencode-client.js doctor --url URL`. It must report a healthy JSON API. Both the documented v1 API and OpenCode v2.2.0 are detected automatically. HTML means the endpoint is a web frontend; HTTP 401 means authentication is needed. Do not treat either as a successful connection.
5. Run `node bin/opencode-client.js install --agent HOST --scope user --url URL` for app-wide access, or `node bin/opencode-client.js install --agent HOST --scope project --target PROJECT --url URL` for project access, and inspect the returned paths and changes. This is a dry run and creates no files.
6. If the preview matches the requested installation, repeat with `--apply`. The installation request authorizes these scoped changes; no extra confirmation is needed unless host policy requires it. A conflict stops installation: preserve and report the conflicting entry rather than deleting it automatically.
7. Reload the host as needed. Check that `opencode_health`, `opencode_projects` and `opencode_models` are exposed and callable. Do not submit a paid task merely to test installation unless the user authorized that test. Report which checks actually ran. Host trust and tool approvals may require user interaction.

Example clone command, after replacing the placeholder with the repository's actual location:

```sh
git clone https://github.com/OWNER/REPO.git opencode-client
cd opencode-client
npm ci
```

Both commands reject a missing `--scope` before reading or changing host configuration. Pass `--scope user` or `--scope project`, including for dry runs and generated configuration.

## App-wide installation (user scope)

User scope registers the MCP server and skill once for the current account, making them available across that host's projects. It does not install for other OS users or automatically configure a remote/cloud agent account. Host policy, profile selection and project overrides still apply.

From a persistent client checkout:

```sh
# Preview first; no files are created.
node bin/opencode-client.js install --agent codex --scope user --url http://127.0.0.1:4096
# Apply the configuration and user skill.
node bin/opencode-client.js install --agent codex --scope user --url http://127.0.0.1:4096 --apply

# Claude Code, across projects for this account.
node bin/opencode-client.js install --agent claude --scope user --url http://127.0.0.1:4096 --apply
```

No `--target` is used with user scope. The installer resolves the current account's home directory, not the working project. `config --agent HOST --scope user` reports the default paths and generates only the client entry without reading existing files.

| Host | User MCP configuration | User skill |
| --- | --- | --- |
| Codex | `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`) | `~/.agents/skills/opencode/SKILL.md` |
| Claude Code | `~/.claude.json`, top-level `mcpServers` | `~/.claude/skills/opencode/SKILL.md` |
| Cursor | `~/.cursor/mcp.json` | `~/.cursor/skills/opencode/SKILL.md` |
| Gemini CLI | `~/.gemini/settings.json` | `~/.gemini/skills/opencode/SKILL.md` |
| OpenCode | `~/.config/opencode/opencode.json` or existing `.jsonc` | `~/.config/opencode/skills/opencode/SKILL.md` |
| VS Code | Explicit active user-profile `mcp.json` via `--config` | `~/.copilot/skills/opencode/SKILL.md` |
| Other MCP hosts | Explicit absolute file path via `--config` | Use the supplied portable skill in the host's supported location |

`CLAUDE_CONFIG_DIR` relocates Claude's configuration and skills; when set, the MCP file is `$CLAUDE_CONFIG_DIR/.claude.json`. `XDG_CONFIG_HOME` relocates OpenCode's config and skill directory. Codex's user skill stays in `~/.agents/skills` even when `CODEX_HOME` is customized. Run the installer in the same environment used to launch the host, and inspect the preview if it uses a custom profile. The library's `config` and `install` functions also accept `home` and `env` when resolving paths for a portable installation environment.

For VS Code, use **MCP: Open User Configuration** to identify the active profile's `mcp.json`; the installing agent can then apply:

```sh
node bin/opencode-client.js install --agent vscode --scope user --config "/absolute/path/to/active-profile/mcp.json" --apply
```

VS Code supports multiple harnesses and configuration formats. This adapter targets the VS Code `servers` format. For a Copilot global `mcp-config.json` using `mcpServers`, use `--agent generic` with that file's absolute path. The installing agent should resolve the real profile path rather than create a guessed default.

User-wide installation previews include paths and only the proposed client entry (`preview: "entry-only"`), not the existing account file. Actual writes preserve its unrelated settings and create a backup. Dry-run and apply have the same scope/path rules. `--config` must be absolute in user scope; project scope resolves it inside `--target`.

## Project installation: Codex and Claude Code

```sh
node bin/opencode-client.js install --agent codex --scope project --target /path/to/project --url http://127.0.0.1:4096
node bin/opencode-client.js install --agent codex --scope project --target /path/to/project --url http://127.0.0.1:4096 --apply
```

For Claude Code, substitute `--agent claude`. The installer adds one `opencode-client` MCP entry and copies the shared delegation skill. Codex uses `.agents/skills/opencode/SKILL.md`; Claude uses `.claude/skills/opencode/SKILL.md`. Project-scoped settings may require the host to trust the project before loading them.

The repository also contains a skills-only Codex plugin manifest; MCP registration still uses the installer above. The repository also contains a Claude plugin manifest and MCP configuration. After `npm ci`, the local development route is:

```sh
claude --plugin-dir /absolute/path/to/opencode-client
```

Use either the native plugin or a user/project installation for a given host session to avoid duplicate tool/skill registrations. Follow the host's current plugin installation workflow for distribution; installing a source checkout alone does not run `npm ci` in a plugin cache.

## Other hosts

The same `install` command supports `cursor`, `vscode`, `gemini`, and `opencode`. These adapters install MCP configuration and the shared skill in their native project skill directory. The portable workflow is in `skills/opencode/SKILL.md`; hosts can use it through their own supported skill/rule mechanism. Do not configure an OpenCode task to recursively delegate to the same session through this client.

For Windsurf, Cline, Roo or another MCP host:

```sh
node bin/opencode-client.js config --agent windsurf --scope user --url http://127.0.0.1:4096
node bin/opencode-client.js config --agent generic --scope user --url http://127.0.0.1:4096
```

The command returns a JSON envelope with `content`, which contains the host configuration text. Merge that content into the host's MCP settings. It is not the entire stdout envelope that belongs in those settings. These profiles do not guess a user-global path. An installing agent can resolve the host's actual settings file and use the same preservation/backup installer automatically:

```sh
node bin/opencode-client.js install --agent windsurf --scope project --target /path/to/settings-directory --config mcp_config.json --url http://127.0.0.1:4096
node bin/opencode-client.js install --agent windsurf --scope project --target /path/to/settings-directory --config mcp_config.json --url http://127.0.0.1:4096 --apply
```

`--config` is resolved inside `--target` in project scope; select the directory containing the real settings file. For app-wide configuration use `--scope user --config /absolute/path/to/settings.json` without `--target`. Use `cline`, `roo`, or `generic` for those hosts. The installing agent should discover the current host path from its settings or official documentation and perform the merge, rather than ask the user to edit JSON.

## Configuration and authentication

| Setting | Meaning | Default |
| --- | --- | --- |
| `OPENCODE_URL` / `--url` | API base URL, including an optional proxy prefix | `http://127.0.0.1:4096` |
| `OPENCODE_SERVER_USERNAME` | HTTP Basic authentication username | `opencode` |
| `OPENCODE_SERVER_PASSWORD` | HTTP Basic authentication password | Unset |
| `OPENCODE_TOKEN` | Bearer token for a compatible authenticated proxy | Unset; takes precedence over Basic auth |
| `OPENCODE_TIMEOUT_MS` | Per-request timeout in milliseconds | `30000` |

Native OpenCode password authentication uses Basic auth; a bearer token is only useful when your endpoint accepts it. Provide secrets through the environment of the process launching the host/MCP server. Codex config explicitly forwards the credential variables; Gemini config uses its environment substitution syntax because Gemini filters inherited secrets. Other hosts may have their own environment filtering or secret storage, so verify credentials reach the MCP process without printing them.

OpenCode v2 may generate a password when `opencode serve` starts even if no environment password was supplied. Read the URL and password from that command's startup output and set the client's environment accordingly; never infer that an unset variable means the running server is unauthenticated.

A `.env` file is not loaded automatically. Export variables using your shell or host's secret mechanism. Do not put real secrets in generated examples, Git commits, issue reports or command-line URLs.

`127.0.0.1` refers to the machine/container running the MCP process. A remote agent, sandbox or container may need a different reachable address or approved tunnel. Server-side project paths likewise belong to the server, not necessarily to the agent's machine. Use HTTPS or a trusted tunnel for remote access; the client does not disable certificate checks.

## Moving from project to user scope

1. Preview and apply the user installation for the same host and intended server URL.
2. After verifying the user entry, remove only the old project's `opencode-client` MCP entry and its installed `opencode` skill if you want to stop overriding the user installation. Preserve other settings. Do not delete a repository's plugin source files as part of migration.
3. Reload the host and verify health/discovery from a second project. Claude project/local MCP entries override its user entry; project configuration may also override user defaults in other hosts.

The installer does not automatically remove project entries, scan every project, or alter other accounts. Installing globally makes the integration available across projects; it does not select a default OpenCode project. Tasks still specify the discovered server-side `directory`.

## Preservation, updates and removal

The installer preserves unrelated JSON/JSONC settings and comments, validates TOML before appending its table, and refuses a differing existing `opencode-client` entry or skill. Identical installations are unchanged. Existing files that change receive a restrictive-permission backup, and each replacement is atomic. Installation across multiple files is not a transaction; inspect the reported paths if an I/O failure occurs.

To update the checkout, review upstream changes, update it, run `npm ci`, and repeat the installation preview. If the executable path, URL or skill changed, explicitly edit/remove only this client's entry or skill after reviewing it; the installer will not silently replace it. Backups may include private configuration, so keep them out of Git.

To remove the integration, delete only the `opencode-client` entry from the relevant project or user MCP config and the installed `opencode` skill if it belongs to this package. Preserve other entries. For a native Claude plugin, use Claude's plugin removal workflow. Reload the host afterward. Existing OpenCode sessions and files remain on the server.

## Host references

- [Codex MCP](https://developers.openai.com/codex/mcp)
- [Claude Code MCP](https://code.claude.com/docs/en/mcp) and [plugin reference](https://code.claude.com/docs/en/plugins-reference)
- [Cursor MCP](https://cursor.com/docs/context/mcp)
- [VS Code MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers)
- [Gemini CLI MCP](https://geminicli.com/docs/tools/mcp-server/)
- [OpenCode MCP](https://opencode.ai/docs/mcp-servers/)

Skill locations follow the official [Cursor skills](https://cursor.com/docs/skills), [VS Code skills](https://code.visualstudio.com/docs/agent-customization/agent-skills), [Gemini skills](https://geminicli.com/docs/cli/skills/), and [OpenCode skills](https://opencode.ai/docs/skills/) documentation.

User-wide paths and precedence are documented in [Codex configuration](https://developers.openai.com/codex/config-reference), [Claude MCP scopes](https://code.claude.com/docs/en/mcp#user-scope), [Cursor MCP locations](https://cursor.com/docs/mcp), [Gemini settings](https://geminicli.com/docs/reference/configuration/), and [OpenCode global configuration](https://opencode.ai/docs/config/).
