import {
  readFile,
  writeFile,
  mkdir,
  lstat,
  rename,
  unlink,
} from "node:fs/promises";
import { dirname, join, resolve, relative, sep, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { parse as parseJson, modify, applyEdits } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";

const root = fileURLToPath(new URL("../", import.meta.url));
const name = "opencode-client";
const profiles = {
  codex: {
    path: ".codex/config.toml",
    format: "toml",
    key: "mcp_servers",
    skill: ".agents/skills/opencode/SKILL.md",
  },
  claude: {
    path: ".mcp.json",
    key: "mcpServers",
    skill: ".claude/skills/opencode/SKILL.md",
  },
  cursor: {
    path: ".cursor/mcp.json",
    key: "mcpServers",
    skill: ".cursor/skills/opencode/SKILL.md",
  },
  vscode: {
    path: ".vscode/mcp.json",
    key: "servers",
    skill: ".github/skills/opencode/SKILL.md",
  },
  gemini: {
    path: ".gemini/settings.json",
    key: "mcpServers",
    skill: ".gemini/skills/opencode/SKILL.md",
  },
  opencode: {
    path: "opencode.json",
    key: "mcp",
    skill: ".opencode/skills/opencode/SKILL.md",
  },
  generic: { key: "mcpServers" },
  windsurf: { key: "mcpServers" },
  cline: { key: "mcpServers" },
  roo: { key: "mcpServers" },
};

function scopedProfile(agent, scope, home, env) {
  if (scope === undefined)
    throw new Error("scope is required; pass --scope user or --scope project");
  if (!["project", "user"].includes(scope))
    throw new Error("scope must be project or user");
  const base = Object.hasOwn(profiles, agent) ? profiles[agent] : undefined;
  if (!base)
    throw new Error(
      `Unsupported agent: ${agent}. Choose ${Object.keys(profiles).join(", ")}.`,
    );
  if (scope === "project") return base;
  home = resolve(home);
  const profile = { ...base, path: null, skill: null };
  switch (agent) {
    case "codex":
      profile.path = join(
        resolve(env.CODEX_HOME || join(home, ".codex")),
        "config.toml",
      );
      profile.skill = join(home, ".agents/skills/opencode/SKILL.md");
      break;
    case "claude": {
      const directory = resolve(env.CLAUDE_CONFIG_DIR || join(home, ".claude"));
      profile.path = env.CLAUDE_CONFIG_DIR
        ? join(directory, ".claude.json")
        : join(home, ".claude.json");
      profile.skill = join(directory, "skills/opencode/SKILL.md");
      break;
    }
    case "cursor":
    case "gemini":
      profile.path = join(home, base.path);
      profile.skill = join(home, base.skill);
      break;
    case "opencode": {
      const directory = join(
        resolve(env.XDG_CONFIG_HOME || join(home, ".config")),
        "opencode",
      );
      profile.path = join(directory, "opencode.json");
      profile.skill = join(directory, "skills/opencode/SKILL.md");
      break;
    }
    case "vscode":
      profile.skill = join(home, ".copilot/skills/opencode/SKILL.md");
      break;
  }
  return profile;
}

function settings(
  agent,
  url,
  { scope, home = homedir(), env = process.env } = {},
) {
  const profile = scopedProfile(agent, scope, home, env);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Server URL must be an absolute HTTP(S) URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new Error("Server URL must use HTTP(S).");
  if (parsed.username || parsed.password)
    throw new Error(
      "Do not put credentials in the URL; use environment variables.",
    );
  if (parsed.hash || parsed.search)
    throw new Error("Server URL must not contain a query or fragment.");
  const entry = {
    command: process.execPath,
    args: [join(root, "bin", "opencode-client.js"), "mcp"],
    env: { OPENCODE_URL: url },
  };
  if (agent === "vscode") entry.type = "stdio";
  if (agent === "gemini") {
    entry.env.OPENCODE_SERVER_PASSWORD = "${OPENCODE_SERVER_PASSWORD}";
    entry.env.OPENCODE_SERVER_USERNAME = "${OPENCODE_SERVER_USERNAME}";
    entry.env.OPENCODE_TOKEN = "${OPENCODE_TOKEN}";
  }
  if (agent === "codex")
    entry.env_vars = [
      "OPENCODE_SERVER_PASSWORD",
      "OPENCODE_SERVER_USERNAME",
      "OPENCODE_TOKEN",
    ];
  if (agent === "opencode")
    return {
      profile,
      entry: {
        type: "local",
        command: [entry.command, ...entry.args],
        environment: entry.env,
        enabled: true,
      },
    };
  return { profile, entry };
}

function toml(entry) {
  // JSON basic strings and arrays use compatible escaping for these string-only values.
  return `[mcp_servers."${name}"]\ncommand = ${JSON.stringify(entry.command)}\nargs = ${JSON.stringify(entry.args)}\nenv_vars = ${JSON.stringify(entry.env_vars)}\n\n[mcp_servers."${name}".env]\nOPENCODE_URL = ${JSON.stringify(entry.env.OPENCODE_URL)}\n`;
}

/** Generate host configuration without changing the filesystem. */
export function config({
  agent = "generic",
  url = process.env.OPENCODE_URL || "http://127.0.0.1:4096",
  scope,
  home = homedir(),
  env = process.env,
} = {}) {
  const { profile, entry } = settings(agent, url, { scope, home, env });
  return {
    agent,
    scope,
    relativePath: scope === "project" ? profile.path || null : null,
    path: scope === "user" ? profile.path : null,
    skillPath: profile.skill || null,
    format: profile.format || "json",
    content:
      profile.format === "toml"
        ? toml(entry)
        : `${JSON.stringify({ [profile.key]: { [name]: entry } }, null, 2)}\n`,
  };
}

const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function merge(original, profile, entry) {
  let data;
  if (profile.format === "toml") {
    data = parseToml(original);
  } else {
    const errors = [];
    data = parseJson(original, errors, { allowTrailingComma: true });
    if (errors.length)
      throw new Error(
        "Existing configuration contains invalid JSON/JSONC; repair it before installing.",
      );
  }
  if (!object(data))
    throw new Error("Existing configuration must be an object.");
  if (Object.hasOwn(data, profile.key) && !object(data[profile.key]))
    throw new Error(`${profile.key} must be an object/table.`);
  const servers = data[profile.key];
  if (servers && Object.hasOwn(servers, name)) {
    // Compare like parser representations: TOML tables have null prototypes.
    const expected =
      profile.format === "toml"
        ? parseToml(toml(entry)).mcp_servers[name]
        : entry;
    if (isDeepStrictEqual(servers[name], expected)) return original;
    throw new Error(
      `${name} already exists with different settings. Remove or update that entry explicitly before reinstalling.`,
    );
  }
  if (profile.format === "toml") {
    const updated = `${original}${original.endsWith("\n") ? "" : "\n"}\n${toml(entry)}`;
    // Reject unsupported TOML layouts (for example a previously sealed inline table).
    parseToml(updated);
    return updated;
  }
  return applyEdits(
    original,
    modify(original, [profile.key, name], entry, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    }),
  );
}

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function rejectSymlinks(target, path) {
  const parts = relative(target, path).split(sep);
  let current = target;
  for (const part of ["", ...parts]) {
    current = join(current, part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink())
        throw new Error(
          `Refusing to install through a symbolic link: ${current}`,
        );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

/** Preview or apply project- or user-scoped configuration. Existing entries are never replaced. */
export async function install({
  agent,
  target,
  url = process.env.OPENCODE_URL || "http://127.0.0.1:4096",
  apply = false,
  configPath,
  scope,
  home = homedir(),
  env = process.env,
} = {}) {
  const generated = config({ agent, url, scope, home, env });
  const { profile, entry } = settings(generated.agent, url, {
    scope,
    home,
    env,
  });
  if (scope === "user" && target !== undefined)
    throw new Error(
      "--target applies only to project scope; use --config with an absolute user configuration path",
    );
  if (!profile.path && !configPath)
    throw new Error(
      `${generated.agent} supports configuration generation only unless --config identifies the host settings file${scope === "user" ? " (use the absolute path to the active user profile MCP file)" : ""}.`,
    );
  let path;
  let relativePath = null;
  if (scope === "project") {
    target = resolve(target || process.cwd());
    relativePath = configPath
      ? relative(target, resolve(target, configPath))
      : profile.path;
    if (
      isAbsolute(relativePath) ||
      !relativePath ||
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`)
    )
      throw new Error("Configuration file must be inside the target directory");
    path = join(target, relativePath);
  } else {
    if (configPath && !isAbsolute(configPath))
      throw new Error("User --config must be an absolute path");
    path = configPath ? resolve(configPath) : profile.path;
    target = resolve(home);
  }
  if (!configPath && agent === "opencode") {
    const jsonc = join(dirname(path), "opencode.jsonc");
    if ((await readOptional(jsonc)) !== null) {
      if ((await readOptional(path)) !== null)
        throw new Error(
          "Both opencode.json and opencode.jsonc exist. Select one configuration before installing.",
        );
      path = jsonc;
      if (scope === "project") relativePath = relative(target, path);
    }
  }
  const rootFor = (file) => {
    const inside = relative(target, file);
    return scope === "project" ||
      (!isAbsolute(inside) && inside !== ".." && !inside.startsWith(`..${sep}`))
      ? target
      : dirname(file);
  };
  await rejectSymlinks(rootFor(path), path);
  const original = await readOptional(path);
  const content =
    original === null ? generated.content : merge(original, profile, entry);
  const pending = [{ path, original, content, root: rootFor(path) }];
  if (profile.skill) {
    const skillPath =
      scope === "user" ? profile.skill : join(target, profile.skill);
    await rejectSymlinks(rootFor(skillPath), skillPath);
    const oldSkill = await readOptional(skillPath);
    const skill = await readFile(
      join(root, "skills/opencode/SKILL.md"),
      "utf8",
    );
    if (oldSkill !== null && oldSkill !== skill)
      throw new Error(
        `Skill already exists with different content: ${skillPath}. Update or remove it explicitly.`,
      );
    pending.push({
      path: skillPath,
      original: oldSkill,
      content: skill,
      root: rootFor(skillPath),
    });
  }
  // All conflicts and parse errors are checked before the first write.
  const files = pending.map((item, index) => ({
    path: item.path,
    changed: item.original !== item.content,
    content: scope === "user" && index === 0 ? generated.content : item.content,
    ...(scope === "user" && index === 0 ? { preview: "entry-only" } : {}),
  }));
  if (apply) {
    for (const [index, item] of pending.entries()) {
      if (!files[index].changed) continue;
      await rejectSymlinks(item.root, item.path);
      if ((await readOptional(item.path)) !== item.original)
        throw new Error(
          `Configuration changed during installation: ${item.path}. Retry after reviewing it.`,
        );
      await mkdir(dirname(item.path), { recursive: true });
      if (item.original !== null) {
        const backup = `${item.path}.opencode-client-${randomUUID()}.bak`;
        await writeFile(backup, item.original, { flag: "wx", mode: 0o600 });
        files[index].backup = backup;
      }
      const temporary = `${item.path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, item.content, { flag: "wx", mode: 0o600 });
        await rename(temporary, item.path);
      } finally {
        await unlink(temporary).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    }
  }
  return {
    agent: generated.agent,
    scope,
    applied: apply,
    files,
    config: {
      ...generated,
      relativePath,
      path,
      content: scope === "user" ? generated.content : content,
    },
  };
}
