# Contributing

Bug reports, compatibility fixes and focused pull requests are welcome. Include the Node version, OpenCode API/server version and agent host version. Remove credentials, private prompts, file contents and private paths from shared logs.

## Development

```sh
npm ci
npm test
npm run check
```

Use Node.js 22 or newer. No build is required. Tests use temporary directories and local HTTP fixtures, so they should run without a real OpenCode server or paid model calls. A sandbox may need permission to bind a loopback test server.

Keep tool definitions in `src/tools.js` so CLI and MCP contracts remain aligned. Add behavior tests for HTTP request/response handling, correlation and lifecycle changes. For an installer change, verify explicit scope selection (including rejection of a missing scope) and both project and user scopes: preservation of unrelated configuration and comments, idempotency, conflict refusal, dry-run behavior, host directory overrides and user-preview privacy. Supply a temporary `home` and isolated `env` to user-scope library tests; never apply them to a real user profile. CLI application tests should use an explicit temporary config path with a generic profile. Do not add a host's guessed configuration path: cite its official documentation and distinguish configuration generation from an installation adapter.

Run a real-host smoke test when feasible and record the exact versions and operations verified. Never label every host supported interactively solely because a JSON fixture passed. Obtain authorization before tests that submit paid tasks, modify files or interrupt existing sessions.

## Pull requests

Describe the concrete problem, resulting behavior and verification. Link relevant API or host documentation. Note compatibility changes, limitations and any live checks that were not run. Keep dependency changes and unrelated refactoring separate when possible.

Before a public release, maintainers should select the repository URL/package namespace, verify license and package contents, run the test matrix, test Codex and Claude Code loading, and document supported OpenCode versions. The repository is usable from a checkout without npm or marketplace publication.
