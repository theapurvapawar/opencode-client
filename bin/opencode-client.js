#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { OpenCodeClient, connect } from "../src/client.js";
import { toolsFor, callTool } from "../src/tools.js";
import { serve } from "../src/mcp.js";
import { install, config } from "../src/install.js";
const help = `OpenCode agent client (Node.js >=22)

  opencode-client mcp [--url URL]               Run MCP over stdio
  opencode-client tools                         List tool names and JSON schemas
  opencode-client call <tool> [JSON | @file | -] Call tool, print JSON
  opencode-client doctor [--url URL]            Check JSON API connectivity
  opencode-client config --agent AGENT          Generate host MCP config
  opencode-client install --agent AGENT --target DIR [--config FILE] [--apply]

Options: --url URL (or OPENCODE_URL), --agent, --target, --config, --apply, --help
Install defaults to dry run. Tool arguments are JSON; '-' reads stdin.
Auth: OPENCODE_SERVER_PASSWORD / OPENCODE_SERVER_USERNAME or OPENCODE_TOKEN.
See INSTALL.md and docs/usage.md. No mutation is automatically retried.`;
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      url: { type: "string" },
      agent: { type: "string" },
      target: { type: "string" },
      config: { type: "string" },
      apply: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, name, input] = positionals;
  const print = (value) =>
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  if (values.help || !command) process.stdout.write(help + "\n");
  else if (command === "install")
    print(
      await install({
        agent: values.agent,
        target: values.target,
        configPath: values.config,
        url: values.url || process.env.OPENCODE_URL,
        apply: values.apply,
      }),
    );
  else if (command === "config")
    print(
      config({
        agent: values.agent,
        url: values.url || process.env.OPENCODE_URL,
      }),
    );
  else {
    const client =
      command === "tools"
        ? new OpenCodeClient({ url: values.url })
        : await connect({ url: values.url });
    if (command === "mcp") await serve(client);
    else if (command === "doctor") print(await client.health());
    else if (command === "tools")
      print(
        toolsFor(client).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: z.toJSONSchema(t.schema),
          readOnly: t.readOnly,
        })),
      );
    else if (command === "call") {
      if (positionals.length > 3)
        throw new Error("Too many arguments; quote JSON or use @file");
      let raw = input || "{}";
      if (input === "-") {
        raw = "";
        for await (const chunk of process.stdin) raw += chunk;
      } else if (input?.startsWith("@"))
        raw = await readFile(input.slice(1), "utf8");
      print(await callTool(client, name, JSON.parse(raw)));
    } else throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  process.stderr.write(
    JSON.stringify({
      error: error.message,
      ...(error.sessionID
        ? { sessionID: error.sessionID, directory: error.directory }
        : {}),
    }) + "\n",
  );
  process.exitCode = 1;
}
