# Architecture

The package has one HTTP client and two execution surfaces:

```text
Coding agent → stdio MCP server ┐
                               ├→ shared tools → HTTP client → OpenCode server
Shell / automation → JSON CLI ┘
```

- `src/client.js` handles configuration, authentication, HTTP requests, session discovery and task supervision.
- `src/tools.js` defines the shared Zod input contracts and tool handlers.
- `src/mcp.js` registers those contracts with the MCP SDK and marks read-only versus mutating tools.
- `bin/opencode-client.js` exposes MCP, JSON calls, diagnostics and installation commands.
- `src/install.js` generates/merges host configuration and copies the shared skill for Codex and Claude Code.
- `skills/opencode/SKILL.md` describes the workflow, including ownership, verification and permission boundaries.

Node's built-in `fetch` talks to either OpenCode API generation. `connect()` probes the v1 health endpoint and v2 server identity; `src/v2.js` adapts the v2 location, inbox, timeline, model, form and permission contracts to the shared tools. MCP uses the SDK's stdio transport. No background service, browser automation or additional task database is required. The host starts the MCP process, and OpenCode owns sessions and execution. The client supports a base URL prefix and rejects embedded URL credentials, redirects and non-JSON API responses.

## Submission and supervision

Delegation creates a session then posts an asynchronous prompt. Each prompt has a correlation ID returned to the caller. These two operations are not transactional: a failure may leave a created session or an accepted prompt whose response was lost. Errors preserve recovery context and mutations are not retried.

Waiting polls status, messages and optional pending requests. A correlated completed assistant response is required to report completion; an idle snapshot immediately after acceptance is insufficient. Permission/question requests produce a blocked result. A bounded wait does not cancel server work. Polling is used instead of SSE so the same operations are useful through both short-lived CLI calls and MCP tools.

Redirection is ordered abort-and-reprompt. It does not rewind file changes, replace the session transcript or provide live token-level steering. Another client may submit concurrently; there is no cross-client lock or task ownership enforcement.

## Compatibility boundaries

The public [OpenCode server contract](https://opencode.ai/docs/server/) is the primary target. The global experimental session endpoint is optional and falls back on HTTP 404 to known worktree discovery. Permission and question availability is explicit during inspection. A health response alone does not prove every endpoint is compatible. The v2 adapter uses `/api/session` with opaque cursors and `/api/session/active`; completion requires the submitted message to appear in the timeline followed by an idle outcome. V2 inspection exposes forms as questions and todos through tool history because it has no standalone todo endpoint. The v2 API is experimental and future schema changes require verification.

Host integrations are configuration adapters around the same standard MCP server. The JSON CLI is the fallback for agents without MCP. Configuration generation, merging and protocol behavior are testable without installing every host; actual host loading and paid-model execution require separate smoke tests and must be reported separately.

## Security boundary

The MCP server runs locally with its process environment. OpenCode runs tools using the server's own permissions and credentials. Host-side sandbox restrictions do not automatically constrain remote execution. Treat retrieved prompts, files and tool output as untrusted data. MCP annotations describe effects but are not access-control enforcement; the host and OpenCode remain responsible for approvals.
