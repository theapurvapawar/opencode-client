import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export class OpenCodeError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "OpenCodeError";
    Object.assign(this, details);
  }
}
export function validateUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("OpenCode URL must use http or https");
  if (url.username || url.password)
    throw new Error(
      "Do not embed credentials in URLs; use environment variables",
    );
  if (url.search || url.hash)
    throw new Error("OpenCode URL must not contain a query or fragment");
  return url.href.replace(/\/$/, "");
}
const idPath = (value) => encodeURIComponent(value);
// Matches OpenCode's ascending identifier format: 6 timestamp bytes + 14 random characters.
export function messageId() {
  return `msg_${(BigInt(Date.now()) * 4096n).toString(16).padStart(12, "0")}${randomBytes(7).toString("hex")}`;
}

export class OpenCodeClient {
  constructor({
    url = process.env.OPENCODE_URL || "http://127.0.0.1:4096",
    username = process.env.OPENCODE_SERVER_USERNAME || "opencode",
    password = process.env.OPENCODE_SERVER_PASSWORD,
    token = process.env.OPENCODE_TOKEN,
    timeoutMs = Number(process.env.OPENCODE_TIMEOUT_MS || 30000),
  } = {}) {
    this.url = validateUrl(url);
    this.username = username;
    this.password = password;
    this.token = token;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      throw new Error("timeoutMs must be positive");
    this.timeoutMs = timeoutMs;
  }
  async request(
    method,
    path,
    { directory, query = {}, body, signal, timeoutMs = this.timeoutMs } = {},
  ) {
    const url = new URL(this.url + path);
    for (const [key, value] of Object.entries({ ...query, directory }))
      if (value !== undefined) url.searchParams.set(key, String(value));
    const headers = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    else if (this.password)
      headers.authorization = `Basic ${Buffer.from(`${this.username}:${this.password}`).toString("base64")}`;
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok)
        throw new OpenCodeError(
          `OpenCode ${method} ${path}: HTTP ${response.status}${response.status === 401 ? " (check authentication)" : response.status === 404 ? " (endpoint unavailable on this server version)" : ""}`,
          { status: response.status },
        );
      if (response.status === 204) return null;
      if (!response.headers.get("content-type")?.includes("json"))
        throw new OpenCodeError(
          "Expected JSON from the OpenCode API; received a web UI or proxy response. Check OPENCODE_URL and its API prefix.",
        );
      return await response.json();
    } catch (error) {
      if (error instanceof OpenCodeError) throw error;
      // Do not include upstream bodies, headers or URLs: they can contain credentials or private prompts.
      throw new OpenCodeError(
        `OpenCode ${method} ${path} failed (${error.name}). Check connectivity or timeout; mutations are never automatically retried.`,
        { cause: error },
      );
    }
  }
  agents(options = {}) {
    return this.request("GET", "/agent", options);
  }
  status(options = {}) {
    return this.request("GET", "/session/status", options);
  }
  messages({ sessionID, directory, limit, cursor } = {}) {
    if (cursor !== undefined)
      throw new OpenCodeError(
        "Message cursor pagination is available on v2 only",
      );
    return this.request("GET", `/session/${idPath(sessionID)}/message`, {
      directory,
      query: { limit },
    });
  }
  permissions(options = {}) {
    return this.request("GET", "/permission", options);
  }
  questions(options = {}) {
    return this.request("GET", "/question", options);
  }
  permissionReply({ directory, requestID, reply, message }) {
    return this.request("POST", `/permission/${idPath(requestID)}/reply`, {
      directory,
      body: { reply, message },
    });
  }
  questionReply({ directory, requestID, answers }) {
    if (!answers)
      throw new OpenCodeError("v1 question replies require answers");
    return this.request("POST", `/question/${idPath(requestID)}/reply`, {
      directory,
      body: { answers },
    });
  }
  questionReject({ directory, requestID }) {
    return this.request("POST", `/question/${idPath(requestID)}/reject`, {
      directory,
    });
  }
  async health() {
    const health = await this.request("GET", "/global/health");
    if (health?.healthy !== true)
      throw new OpenCodeError("Server did not report a healthy OpenCode API");
    return health;
  }
  projects() {
    return this.request("GET", "/project");
  }
  async models({ directory, connectedOnly = false } = {}) {
    const data = await this.request("GET", "/provider", { directory });
    const connected = new Set(data.connected || []);
    return {
      default: data.default,
      connected: [...connected],
      models: (data.all || [])
        .filter((p) => !connectedOnly || connected.has(p.id))
        .flatMap((p) =>
          Object.values(p.models || {}).map((m) => ({
            providerID: p.id,
            modelID: m.id,
            name: m.name,
            connected: connected.has(p.id),
            limit: m.limit,
            capabilities: m.capabilities,
            cost: m.cost,
          })),
        ),
    };
  }
  async sessions({
    directory,
    allProjects = false,
    limit = 100,
    search,
    start,
    cursor,
    archived,
  } = {}) {
    if (allProjects) {
      // Newer v1 servers provide global pagination. Older ones need one request per worktree.
      try {
        return {
          sessions: await this.request("GET", "/experimental/session", {
            query: { limit, search, start, cursor, archived },
          }),
          scope: "global",
          limit,
          pagination:
            "Use the oldest returned time.updated as cursor; equal timestamps may overlap.",
        };
      } catch (error) {
        if (error.status !== 404) throw error;
      }
      const projects = await this.projects();
      const sessions = new Map();
      const errors = [];
      for (const dir of new Set(
        projects
          .flatMap((p) => [p.worktree, ...(p.sandboxes || [])])
          .filter(Boolean),
      )) {
        try {
          for (const session of await this.request("GET", "/session", {
            directory: dir,
            query: { limit, search, start },
          }))
            sessions.set(session.id, session);
        } catch (error) {
          errors.push({ directory: dir, error: error.message });
        }
      }
      return {
        sessions: [...sessions.values()],
        scope: "known-projects",
        errors,
        limitPerProject: limit,
        pagination:
          "Fallback is bounded per project; increase limit to inspect more history.",
      };
    }
    return {
      sessions: await this.request("GET", "/session", {
        directory,
        query: { limit, search, start },
      }),
      scope: directory || "server-default",
      limit,
    };
  }
  async optional(path, options) {
    try {
      return {
        available: true,
        data: await this.request("GET", path, options),
      };
    } catch (error) {
      if (error.status === 404) return { available: false, data: [] };
      throw error;
    }
  }
  async inspect({ sessionID, directory, limit = 100, signal }) {
    const options = { directory, signal };
    const path = `/session/${idPath(sessionID)}`;
    const [
      session,
      status,
      messages,
      todos,
      diff,
      children,
      permissions,
      questions,
    ] = await Promise.all([
      this.request("GET", path, options),
      this.request("GET", "/session/status", options),
      this.request("GET", `${path}/message`, { ...options, query: { limit } }),
      this.request("GET", `${path}/todo`, options),
      this.request("GET", `${path}/diff`, options),
      this.request("GET", `${path}/children`, options),
      this.optional("/permission", options),
      this.optional("/question", options),
    ]);
    return {
      session,
      status: status[sessionID] || { type: "idle" },
      messages,
      todos,
      diff,
      children,
      permissions: permissions.data.filter((p) => p.sessionID === sessionID),
      questions: questions.data.filter((p) => p.sessionID === sessionID),
      capabilities: {
        permissions: permissions.available,
        questions: questions.available,
      },
      messageLimit: limit,
    };
  }
  async send({
    sessionID,
    directory,
    prompt,
    model,
    agent,
    variant,
    messageID = messageId(),
  }) {
    await this.request("POST", `/session/${idPath(sessionID)}/prompt_async`, {
      directory,
      body: {
        messageID,
        model,
        agent,
        variant,
        parts: [{ type: "text", text: prompt }],
      },
    });
    return { sessionID, directory, messageID, state: "accepted" };
  }
  async delegate({ directory, title, ...prompt }) {
    const session = await this.request("POST", "/session", {
      directory,
      body: { title },
    });
    try {
      return {
        ...(await this.send({ ...prompt, directory, sessionID: session.id })),
        session,
      };
    } catch (error) {
      throw new OpenCodeError(
        `Created session ${session.id}, but prompt acceptance is uncertain. Inspect this session before retrying. ${error.message}`,
        { sessionID: session.id, directory, cause: error },
      );
    }
  }
  abort({ sessionID, directory }) {
    return this.request("POST", `/session/${idPath(sessionID)}/abort`, {
      directory,
    });
  }
  async redirect({ messageID: previousMessageID, ...args }) {
    const aborted = await this.abort(args);
    if (aborted !== true)
      throw new OpenCodeError(
        "Server did not confirm abort; replacement prompt was not sent",
      );
    try {
      return { ...(await this.send(args)), previousRunAborted: true };
    } catch (error) {
      throw new OpenCodeError(
        `Session ${args.sessionID} was aborted, but replacement prompt acceptance is uncertain. Inspect before retrying.`,
        { sessionID: args.sessionID, cause: error },
      );
    }
  }
  async wait({
    sessionID,
    directory,
    messageID,
    timeoutMs = 30000,
    pollMs = 1000,
  }) {
    if (
      !Number.isFinite(timeoutMs) ||
      timeoutMs <= 0 ||
      !Number.isFinite(pollMs) ||
      pollMs <= 0
    )
      throw new Error("wait and poll timeouts must be positive");
    const signal = AbortSignal.timeout(timeoutMs);
    let lastStatus;
    try {
      while (!signal.aborted) {
        const options = { directory, signal };
        const [statuses, messages, permissions, questions] = await Promise.all([
          this.request("GET", "/session/status", options),
          this.request("GET", `/session/${idPath(sessionID)}/message`, options),
          this.optional("/permission", options),
          this.optional("/question", options),
        ]);
        lastStatus = statuses[sessionID] || { type: "idle" };
        const pending = {
          permissions: permissions.data.filter(
            (p) => p.sessionID === sessionID,
          ),
          questions: questions.data.filter((p) => p.sessionID === sessionID),
        };
        if (pending.permissions.length || pending.questions.length)
          return { state: "blocked", sessionID, ...pending };
        const replies = messages.filter(
          (m) =>
            m.info.role === "assistant" &&
            (!messageID || m.info.parentID === messageID),
        );
        const reply = replies.at(-1);
        if (messageID && reply?.info.error)
          return { state: "failed", sessionID, message: reply };
        if (
          messageID &&
          reply?.info.time?.completed &&
          reply.info.finish &&
          !["tool-calls", "unknown"].includes(reply.info.finish) &&
          lastStatus.type === "idle"
        )
          return { state: "completed", sessionID, message: reply };
        // Without a correlation ID, idle means only idle, never proof of completion.
        if (!messageID && lastStatus.type === "idle")
          return { state: "idle", sessionID, messages };
        await delay(pollMs, undefined, { signal });
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    }
    return {
      state: "timeout",
      sessionID,
      messageID,
      status: lastStatus,
      continuing: true,
    };
  }
}

/** Connect to the documented v1 API or the v2 API exposed by current OpenCode releases. */
export async function connect(options = {}) {
  const v1 = new OpenCodeClient(options);
  let v1Error;
  try {
    await v1.health();
    return v1;
  } catch (error) {
    v1Error = error;
  }
  const { OpenCodeV2Client } = await import("./v2.js");
  const v2 = new OpenCodeV2Client(options);
  try {
    await v2.health();
    return v2;
  } catch (error) {
    throw new OpenCodeError(
      `Could not connect to an OpenCode API. v1: ${v1Error.message} v2: ${error.message}`,
      { cause: error },
    );
  }
}
