import { z } from "zod";
const directory = z
  .string()
  .min(1)
  .regex(/^(?:\/|[A-Za-z]:[\\/]|\\\\)/, "Use an absolute server-side directory")
  .describe("Absolute project directory on the OpenCode server");
const sessionID = z.string().min(1);
const session = { sessionID, directory };
const scope = { directory: directory.optional() };
const model = z
  .object({ providerID: z.string().min(1), modelID: z.string().min(1) })
  .strict()
  .optional();
const prompt = {
  prompt: z.string().min(1),
  model,
  agent: z.string().min(1).optional(),
  variant: z.string().optional(),
};
const limit = z.number().int().min(1).max(10000).optional();
export function toolsFor(client) {
  const tools = [];
  function add(name, description, shape, readOnly, run) {
    tools.push({
      name: `opencode_${name}`,
      description,
      schema: z.object(shape).strict(),
      readOnly,
      run,
    });
  }
  add(
    "health",
    "Check connectivity to the OpenCode JSON API and report its version.",
    {},
    true,
    () => client.health(),
  );
  add(
    "projects",
    "List known projects and server-side worktree directories.",
    {},
    true,
    () => client.projects(),
  );
  add(
    "models",
    "List model IDs, capabilities and connected providers. Connected does not imply remaining quota.",
    { ...scope, connectedOnly: z.boolean().optional() },
    true,
    (a) => client.models(a),
  );
  add(
    "agents",
    "List available OpenCode agents for a project.",
    scope,
    true,
    (a) => client.agents(a),
  );
  add(
    "sessions",
    "Discover sessions. Use allProjects for global discovery; inspect pagination and partial errors.",
    {
      ...scope,
      allProjects: z.boolean().optional(),
      limit,
      search: z.string().optional(),
      start: z.number().optional(),
      cursor: z.union([z.number(), z.string()]).optional(),
      archived: z.boolean().optional(),
    },
    true,
    (a) => client.sessions(a),
  );
  add(
    "status",
    "Read running/retrying sessions for a project. Missing entries are idle, not proof of success.",
    { directory },
    true,
    (a) => client.status(a),
  );
  add(
    "inspect",
    "Read a session, recent messages/tool parts, todos, diff, children and pending approvals.",
    { ...session, limit },
    true,
    (a) => client.inspect(a),
  );
  add(
    "messages",
    "Read session message history, including tool calls/results.",
    { ...session, limit, cursor: z.string().optional() },
    true,
    (a) => client.messages(a),
  );
  add(
    "delegate",
    "Create a session and submit a task asynchronously. May modify server files and spend model credits. Save returned IDs.",
    { directory, title: z.string().optional(), ...prompt },
    false,
    (a) => client.delegate(a),
  );
  add(
    "send",
    "Submit a follow-up to an existing idle session asynchronously. Save messageID for wait.",
    { ...session, ...prompt },
    false,
    (a) => client.send(a),
  );
  add(
    "wait",
    "Wait for a correlated assistant response or pending approval, up to a bounded deadline. Timeout does not abort.",
    {
      ...session,
      messageID: z.string().optional(),
      timeoutMs: z.number().int().min(1).max(120000).optional(),
      pollMs: z.number().int().min(100).max(10000).optional(),
    },
    true,
    (a) => client.wait(a),
  );
  add(
    "abort",
    "Stop a session. Existing edits are not rolled back.",
    session,
    false,
    (a) => client.abort(a),
  );
  add(
    "redirect",
    "Abort a session, then submit replacement instructions. Interrupts work; does not revert edits.",
    { ...session, ...prompt },
    false,
    (a) => client.redirect(a),
  );
  add(
    "permissions",
    "List pending permission requests for a project.",
    { directory },
    true,
    (a) => client.permissions(a),
  );
  add(
    "permission_reply",
    "Answer a permission request only with user authority. Always persists broader permission.",
    {
      directory,
      sessionID: sessionID.optional(),
      requestID: z.string().min(1),
      reply: z.enum(["once", "always", "reject"]),
      message: z.string().optional(),
    },
    false,
    (a) => client.permissionReply(a),
  );
  add(
    "questions",
    "List pending clarification questions.",
    { directory },
    true,
    (a) => client.questions(a),
  );
  add(
    "question_reply",
    "Answer a clarification. v1: answers as label arrays. v2: sessionID and answer object keyed by form field ID.",
    {
      directory,
      sessionID: sessionID.optional(),
      requestID: z.string().min(1),
      answers: z.array(z.array(z.string())).optional(),
      answer: z.record(z.string(), z.json()).optional(),
    },
    false,
    (a) => client.questionReply(a),
  );
  add(
    "question_reject",
    "Dismiss a pending clarification request.",
    {
      directory,
      sessionID: sessionID.optional(),
      requestID: z.string().min(1),
    },
    false,
    (a) => client.questionReject(a),
  );
  return tools;
}
export async function callTool(client, name, args = {}) {
  const tool = toolsFor(client).find(
    (t) => t.name === name || t.name === `opencode_${name}`,
  );
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.run(tool.schema.parse(args));
}
