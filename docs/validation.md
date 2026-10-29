# Validation and compatibility

The initial implementation was validated on macOS with Node.js 25.6.0 and OpenCode 2.2.0. Node.js 22+ is the supported runtime; CI is configured for Node 22 and 24 on Ubuntu and Windows. A configured CI matrix is not evidence that those remote jobs have run.

## Automated checks

`npm test` passes 25 tests covering:

- HTTP Basic authentication, URL prefixes and directory encoding; HTML/frontend diagnostics; credential URL rejection.
- Recoverable session creation errors and no automatic prompt retry.
- Correlated waiting, delayed prompt admission, pending permission detection, stale historical replies and interrupt-before-reprompt ordering with a fresh message ID.
- Configuration envelopes for supported hosts, JSONC/TOML preservation, repeat installation, conflicts, backups, skill installation, and explicit-file installation for other MCP hosts.
- Real MCP stdio initialization, tool discovery, input rejection and a delegation/wait round trip against a fixture API.
- V2 detection, model/location selection, opaque session and message pagination, permission/form request formats and interrupted outcomes.

`npm run check` checks JavaScript syntax and source formatting. The production dependency audit reports no known vulnerabilities at validation time. Package contents were inspected and the packaged CLI/installer were smoke-tested from a clean temporary installation.

## Live OpenCode checks

A separate loopback server was started from the installed OpenCode 2.2.0 binary. Its generated password was read privately from startup output and passed through the environment; no credential is included in this repository.

Verified operations were API detection, project/session/model/agent discovery, task submission to a discovered free model, correlated response retrieval, session inspection, interruption/redirection of the test session, and retrieval of the replacement response. Both task replies matched their expected markers, and session diffs showed no file changes. The actual MCP subprocess also exposed all 18 tools and successfully called health and inspection against this server.

The temporary server was stopped after validation. Existing user sessions were not interrupted. V1 behavior is covered by HTTP fixtures and the published API contract, rather than a live v1 server. Permission/form replies are verified against the v2 OpenAPI schema and fixtures; no real permission was granted during testing.

## Coverage limits

Codex and Claude Code configuration and skills were installed into temporary projects and verified for repeat installation. Their interactive UIs and third-party host UIs were not exercised. The Claude local plugin manifests and other host adapters should be checked with the host versions used for a release. V2's API is experimental, so future server releases may require adapter updates.

Code review: skipped (ce-code-review unavailable). The dedicated review worker terminated when workspace credits were exhausted, before producing a completed review receipt. Its confirmed stale-wait, Windows-path and package-content findings were fixed, and a manual source/contract review completed. This is not a claim of an independent completed review.
