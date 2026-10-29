import { OpenCodeClient, OpenCodeError, messageId } from "./client.js";
import { setTimeout as delay } from "node:timers/promises";
const id = encodeURIComponent;
const locationQuery = (directory) =>
  directory ? { "location[directory]": directory } : {};
const modelRef = (model, variant) =>
  model
    ? {
        providerID: model.providerID,
        id: model.modelID,
        ...(variant ? { variant } : {}),
      }
    : undefined;
function message(raw) {
  const { content, text, ...info } = raw;
  return {
    info: { ...info, role: raw.type },
    parts: content || (text ? [{ type: "text", text }] : []),
  };
}

export class OpenCodeV2Client extends OpenCodeClient {
  async health() {
    const info = await this.request("GET", "/api/info");
    if (
      typeof info.version !== "string" ||
      !Number.isInteger(info.pid) ||
      !Array.isArray(info.urls)
    )
      throw new OpenCodeError("Response is not an OpenCode v2 API identity");
    return { healthy: true, version: info.version, api: "v2" };
  }
  async projects() {
    return (await this.request("GET", "/api/project")).map((p) => ({
      ...p,
      worktree: p.canonical,
    }));
  }
  async models({ directory, connectedOnly = false } = {}) {
    const [models, defaults] = await Promise.all([
      this.request("GET", "/api/model", { query: locationQuery(directory) }),
      this.request("GET", "/api/model/default", {
        query: locationQuery(directory),
      }),
    ]);
    return {
      default: defaults.data
        ? { providerID: defaults.data.providerID, modelID: defaults.data.id }
        : null,
      connected: [
        ...new Set(
          models.data.filter((m) => m.enabled).map((m) => m.providerID),
        ),
      ],
      models: models.data
        .filter((m) => !connectedOnly || m.enabled)
        .map((m) => ({
          providerID: m.providerID,
          modelID: m.id,
          upstreamModelID: m.modelID,
          name: m.name,
          connected: m.enabled,
          limit: m.limit,
          capabilities: m.capabilities,
          cost: m.cost,
          variants: m.variants,
        })),
    };
  }
  async agents({ directory } = {}) {
    return (
      await this.request("GET", "/api/agent", {
        query: locationQuery(directory),
      })
    ).data;
  }
  async sessions({
    directory,
    allProjects = false,
    limit = 100,
    search,
    cursor,
    archived,
    start,
    parentID,
  } = {}) {
    if (start !== undefined)
      throw new OpenCodeError(
        "v2 uses opaque cursor pagination; start timestamps are only supported by v1",
      );
    const page = await this.request("GET", "/api/session", {
      query: {
        directory: allProjects ? undefined : directory,
        limit,
        search,
        cursor,
        archived,
        parentID,
        ...(!cursor ? { order: "desc" } : {}),
      },
    });
    return {
      sessions: page.data,
      cursor: page.cursor,
      scope: allProjects ? "global" : directory || "global",
      limit,
      pagination:
        "Pass cursor.next unchanged to continue with the same filters.",
    };
  }
  async status() {
    const { data } = await this.request("GET", "/api/session/active");
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        { ...value, type: "busy" },
      ]),
    );
  }
  async messages({ sessionID, limit = 100, cursor, signal } = {}) {
    const page = await this.request(
      "GET",
      `/api/session/${id(sessionID)}/message`,
      {
        query: { limit, cursor, ...(!cursor ? { order: "desc" } : {}) },
        signal,
      },
    );
    return {
      messages: page.data.map(message),
      cursor: page.cursor,
      order: "desc",
    };
  }
  async permissions({ directory, signal } = {}) {
    return (
      await this.request("GET", "/api/permission/request", {
        query: locationQuery(directory),
        signal,
      })
    ).data;
  }
  async questions({ directory, signal } = {}) {
    return (
      await this.request("GET", "/api/form", {
        query: locationQuery(directory),
        signal,
      })
    ).data;
  }
  async permissionReply({ directory, sessionID, requestID, reply, message }) {
    if (!sessionID)
      throw new OpenCodeError("v2 permission replies require sessionID");
    await this.request(
      "POST",
      `/api/session/${id(sessionID)}/permission/${id(requestID)}/reply`,
      { body: { decision: reply, message } },
    );
    return true;
  }
  async questionReply({ sessionID, requestID, answer }) {
    if (!sessionID || !answer)
      throw new OpenCodeError(
        "v2 form replies require sessionID and an answer object keyed by field ID",
      );
    await this.request(
      "POST",
      `/api/session/${id(sessionID)}/form/${id(requestID)}/reply`,
      { body: { answer } },
    );
    return true;
  }
  async questionReject({ sessionID, requestID }) {
    if (!sessionID)
      throw new OpenCodeError("v2 form cancellation requires sessionID");
    await this.request(
      "DELETE",
      `/api/session/${id(sessionID)}/form/${id(requestID)}`,
    );
    return true;
  }
  async inspect({ sessionID, directory, limit = 100 }) {
    const [
      session,
      status,
      history,
      diff,
      children,
      permissions,
      questions,
      inbox,
    ] = await Promise.all([
      this.request("GET", `/api/session/${id(sessionID)}`),
      this.status(),
      this.messages({ sessionID, limit }),
      this.request("GET", `/api/session/${id(sessionID)}/diff`),
      this.sessions({ parentID: sessionID, limit }),
      this.permissions({ directory }),
      this.questions({ directory }),
      this.request("GET", `/api/session/${id(sessionID)}/inbox`),
    ]);
    const todoTool = history.messages
      .flatMap((m) => m.parts)
      .find((p) => p.type === "tool" && /todo/.test(p.name));
    return {
      session: session.data,
      status: status[sessionID] || { type: "idle" },
      messages: history.messages,
      messageCursor: history.cursor,
      messageOrder: history.order,
      diff: diff.data,
      children: children.sessions,
      childrenCursor: children.cursor,
      inbox,
      todos: todoTool || null,
      permissions: permissions.filter((p) => p.sessionID === sessionID),
      questions: questions.filter((p) => p.sessionID === sessionID),
      capabilities: {
        permissions: true,
        questions: true,
        todos: "tool-history",
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
    if (variant && !model)
      throw new OpenCodeError(
        "v2 requires an explicit model when selecting a variant",
      );
    if (agent)
      await this.request("POST", `/api/session/${id(sessionID)}/agent`, {
        body: { agent },
      });
    if (model)
      await this.request("POST", `/api/session/${id(sessionID)}/model`, {
        body: { model: modelRef(model, variant) },
      });
    const admitted = await this.request(
      "POST",
      `/api/session/${id(sessionID)}/prompt`,
      { body: { id: messageID, text: prompt } },
    );
    return {
      sessionID,
      directory,
      messageID: admitted.data.id,
      state: "accepted",
    };
  }
  async delegate({ directory, title, prompt, model, agent, variant }) {
    if (variant && !model)
      throw new OpenCodeError(
        "v2 requires an explicit model when selecting a variant",
      );
    const { data: session } = await this.request("POST", "/api/session", {
      body: {
        title,
        location: { directory },
        agent,
        model: modelRef(model, variant),
      },
    });
    try {
      return {
        ...(await this.send({ sessionID: session.id, directory, prompt })),
        session,
      };
    } catch (error) {
      throw new OpenCodeError(
        `Created session ${session.id}, but prompt acceptance is uncertain. Inspect before retrying. ${error.message}`,
        { sessionID: session.id, directory, cause: error },
      );
    }
  }
  async abort({ sessionID }) {
    const result = await this.request(
      "POST",
      `/api/session/${id(sessionID)}/interrupt`,
      { query: { resume: false } },
    );
    if (typeof result.interrupted !== "boolean")
      throw new OpenCodeError("Invalid v2 interrupt response");
    return true;
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
        const [statuses, permissions, questions] = await Promise.all([
          this.request("GET", "/api/session/active", { signal }),
          this.permissions({ directory, signal }),
          this.questions({ directory, signal }),
        ]);
        lastStatus = statuses.data[sessionID] || { type: "idle" };
        const pending = {
          permissions: permissions.filter((p) => p.sessionID === sessionID),
          questions: questions.filter((p) => p.sessionID === sessionID),
        };
        if (pending.permissions.length || pending.questions.length)
          return { state: "blocked", sessionID, ...pending };
        if (!messageID && lastStatus.type === "idle")
          return { state: "idle", sessionID };
        let cursor;
        const timeline = [];
        let found = false;
        do {
          const page = await this.messages({
            sessionID,
            limit: 100,
            cursor,
            signal,
          });
          timeline.push(...page.messages);
          found = timeline.some((m) => m.info.id === messageID);
          cursor = page.cursor?.next;
        } while (!found && cursor && !signal.aborted);
        if (found) {
          const after = timeline
            .slice(
              0,
              timeline.findIndex((m) => m.info.id === messageID),
            )
            .reverse();
          const idleIndex = after.findIndex((m) => m.info.type === "idle");
          if (idleIndex !== -1) {
            const idle = after[idleIndex].info;
            const reply = after
              .slice(0, idleIndex)
              .filter((m) => m.info.type === "assistant")
              .at(-1);
            return {
              state:
                idle.outcome === "succeeded"
                  ? "completed"
                  : idle.outcome === "interrupted"
                    ? "interrupted"
                    : "failed",
              sessionID,
              message: reply,
              outcome: idle.outcome,
              error: idle.error,
            };
          }
        }
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
