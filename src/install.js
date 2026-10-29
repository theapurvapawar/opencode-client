import {
  readFile,
  writeFile,
  mkdir,
  lstat,
  rename,
  unlink,
} from "node:fs/promises";
import { dirname, join, resolve, relative, sep, isAbsolute } from "node:path";
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

function settings(agent, url) {
  const profile = Object.hasOwn(profiles, agent) ? profiles[agent] : undefined;
  if (!profile)
    throw new Error(
      `Unsupported agent: ${agent}. Choose ${Object.keys(profiles).join(", ")}.`,
    );
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
} = {}) {
  const { profile, entry } = settings(agent, url);
  return {
    agent,
    relativePath: profile.path || null,
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

/** Preview or apply project-scoped configuration. Existing entries are never replaced. */
export async function install({
  agent,
  target = process.cwd(),
  url = process.env.OPENCODE_URL || "http://127.0.0.1:4096",
  apply = false,
  configPath,
} = {}) {
  const generated = config({ agent, url });
  const { profile, entry } = settings(generated.agent, url);
  if (!profile.path && !configPath)
    throw new Error(
      `${generated.agent} supports configuration generation only unless --config identifies the host settings file.`,
    );
  target = resolve(target);
  let relativePath = configPath
    ? relative(target, resolve(target, configPath))
    : profile.path;
  if (
    isAbsolute(relativePath) ||
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  )
    throw new Error("Configuration file must be inside the target directory");
  // OpenCode recognizes both formats; preserve an existing JSONC file instead of shadowing it.
  if (
    !configPath &&
    agent === "opencode" &&
    (await readOptional(join(target, "opencode.jsonc"))) !== null
  ) {
    if ((await readOptional(join(target, "opencode.json"))) !== null)
      throw new Error(
        "Both opencode.json and opencode.jsonc exist. Select one configuration before installing.",
      );
    relativePath = "opencode.jsonc";
  }
  const path = join(target, relativePath);
  await rejectSymlinks(target, path);
  const original = await readOptional(path);
  const content =
    original === null ? generated.content : merge(original, profile, entry);
  const pending = [{ path, original, content }];
  if (profile.skill) {
    const skillPath = join(target, profile.skill);
    await rejectSymlinks(target, skillPath);
    const oldSkill = await readOptional(skillPath);
    const skill = await readFile(
      join(root, "skills/opencode/SKILL.md"),
      "utf8",
    );
    if (oldSkill !== null && oldSkill !== skill)
      throw new Error(
        `Skill already exists with different content: ${skillPath}. Update or remove it explicitly.`,
      );
    pending.push({ path: skillPath, original: oldSkill, content: skill });
  }
  // All conflicts and parse errors are checked before the first write.
  const files = pending.map((item) => ({
    path: item.path,
    changed: item.original !== item.content,
    content: item.content,
  }));
  if (apply) {
    for (const [index, item] of pending.entries()) {
      if (!files[index].changed) continue;
      await rejectSymlinks(target, item.path);
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
    applied: apply,
    files,
    config: { ...generated, relativePath, content },
  };
}
