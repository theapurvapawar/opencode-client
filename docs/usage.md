# Using the client

All examples run from the client checkout. Replace sample project paths, session IDs and model IDs with discovered values. Shell examples use POSIX quoting; `@file` works across platforms when JSON quoting is inconvenient.

## Discover the server

```sh
node bin/opencode-client.js doctor --url http://127.0.0.1:4096
node bin/opencode-client.js call projects
node bin/opencode-client.js call models '{"connectedOnly":true}'
node bin/opencode-client.js call agents '{"directory":"/srv/project"}'
node bin/opencode-client.js call sessions '{"allProjects":true,"limit":100}'
node bin/opencode-client.js call status '{"directory":"/srv/project"}'
```

`models` returns provider IDs, model IDs, connection status and available model metadata. Connection status does not establish quota or permission to use a model.

On v2, session lists return `cursor.next` and `cursor.previous`; pass these opaque strings unchanged with the same filters. Messages return a descending page with its own cursor. On v1, global session discovery first uses `/experimental/session`. If unavailable with HTTP 404, it queries known project worktrees and sandboxes and returns partial errors explicitly. Lists are bounded. On the global endpoint, use the oldest returned `time.updated` as `cursor` for older results, deduplicate IDs, and inspect overlapping timestamps. The fallback exposes a per-project limit rather than global pagination. A result is not a guarantee of every historical session. Project status reports running/retrying sessions; missing entries are idle, which does not prove task success.

## Delegate and retrieve a result

```sh
node bin/opencode-client.js call delegate '{"directory":"/srv/project","title":"Review parser","prompt":"Review src/parser for correctness. Do not edit files. Report findings and supporting line references.","model":{"providerID":"PROVIDER_ID","modelID":"MODEL_ID"}}'
```

Save the returned `sessionID`, `directory` and `messageID`. The initial state is `accepted` and does not contain the final answer.

```sh
node bin/opencode-client.js call wait '{"sessionID":"ses_EXAMPLE","directory":"/srv/project","messageID":"msg_EXAMPLE","timeoutMs":30000}'
node bin/opencode-client.js call inspect '{"sessionID":"ses_EXAMPLE","directory":"/srv/project","limit":100}'
node bin/opencode-client.js call messages '{"sessionID":"ses_EXAMPLE","directory":"/srv/project","limit":200}'
```

With `messageID`, `wait` correlates the assistant reply to that submission and checks terminal completion. It can return `completed`, `failed`, `interrupted` (v2), `blocked` or `timeout`. Without a message ID, it can return `idle`; that is only a status observation. A timeout leaves the task running and can be followed by another wait. The MCP/CLI wait accepts at most 120 seconds per call; 30 seconds is the default. Host-level tool timeouts may be shorter.

`inspect` includes session metadata, status, messages and tool parts, todos, diffs, child sessions and pending permissions/questions. On v1 it reports whether optional permission/question endpoints are available. On v2 it includes the durable inbox, message/child pagination cursors, forms as questions, and the most recent todo tool entry if present. Read the result and verify actual changes before calling a delegated task successful.

## Follow up, interrupt or redirect

```sh
node bin/opencode-client.js call send '{"sessionID":"ses_EXAMPLE","directory":"/srv/project","prompt":"Expand the second finding with a reproduction."}'
node bin/opencode-client.js call abort '{"sessionID":"ses_EXAMPLE","directory":"/srv/project"}'
node bin/opencode-client.js call redirect '{"sessionID":"ses_EXAMPLE","directory":"/srv/project","prompt":"Stop the implementation approach. Review the existing changes and report risks without further edits."}'
```

Use `send` for a follow-up to an idle session. `redirect` requires the server to confirm abort before posting a new prompt. Neither operation reverts edits. Inspect existing work and ownership before interrupting another task. Concurrent clients can still change the same session; the client provides no distributed lock.

## Permissions and questions

```sh
node bin/opencode-client.js call permissions '{"directory":"/srv/project"}'
node bin/opencode-client.js call permission_reply '{"directory":"/srv/project","requestID":"per_EXAMPLE","reply":"once"}'
node bin/opencode-client.js call questions '{"directory":"/srv/project"}'
node bin/opencode-client.js call question_reply '{"directory":"/srv/project","requestID":"que_EXAMPLE","answers":[["Selected option"]]}'
node bin/opencode-client.js call question_reject '{"directory":"/srv/project","requestID":"que_EXAMPLE"}'
```

For v2, permission replies also require `sessionID`. Questions are forms: pass `sessionID` and an `answer` object keyed by the field IDs from the returned form, instead of the v1 `answers` array. Form values follow the server's field types. For example:

```sh
node bin/opencode-client.js call permission_reply '{"directory":"/srv/project","sessionID":"ses_EXAMPLE","requestID":"per_EXAMPLE","reply":"once"}'
node bin/opencode-client.js call question_reply '{"directory":"/srv/project","sessionID":"ses_EXAMPLE","requestID":"form_EXAMPLE","answer":{"field_id":"Selected option"}}'
```

Permission replies are `once`, `always` or `reject`. Reply only with user authority. `always` grants a broader persistent permission. Question answers are arrays of selected labels in question order; free-text answers depend on the server's request. Unsupported endpoints produce errors rather than a simulated approval.

## JSON and library interface

```sh
node bin/opencode-client.js tools
node bin/opencode-client.js call delegate @task.json
node bin/opencode-client.js call delegate - < task.json
```

Successful commands print JSON to stdout; errors print JSON to stderr and set a nonzero exit code. MCP uses stdout exclusively for protocol messages. Credentials are not arguments to tools.

The package also exports the HTTP client:

```js
import { connect } from 'opencode-agent-client';
const client = await connect({ url: 'http://127.0.0.1:4096' });
const projects = await client.projects();
```

That package import applies after installing this repository as a local dependency; no npm publication is assumed. From the checkout, import `./src/client.js`. MCP and CLI inputs are validated against the schemas printed by `tools`; direct library users must supply valid arguments.

## Failures and recovery

Mutating requests are never retried automatically. If a request times out or loses its response, it may already have executed. Inspect before retrying. If session creation succeeded but prompt submission failed, the error includes the created session ID for recovery. Keep it rather than creating repeated sessions blindly.

HTML from `doctor` usually means a frontend URL or proxy fallback; HTTP 401 means credentials are missing or rejected. HTTP 404 may indicate an unsupported endpoint/API generation. Check the server's `/doc` (v1) or `/openapi.json` (v2) and [server documentation](https://opencode.ai/docs/server/). This client does not discover or bypass a web application's authentication session.

## Install across projects

```sh
node bin/opencode-client.js config --agent codex --scope user
node bin/opencode-client.js install --agent codex --scope user
node bin/opencode-client.js install --agent codex --scope user --apply
```

Use `--agent claude` for Claude Code or the other supported adapters. `--scope user` installs MCP and the skill for the current account; it does not change how tasks select a server-side project. Keep passing a discovered absolute `directory` for task operations. See [installation scope, paths and migration](../INSTALL.md) for other hosts and project overrides.
