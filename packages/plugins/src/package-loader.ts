import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ALLOWED_EXTERNAL_URLS, type ConnectorSetup } from "@zhiyin/contract";
import {
  AGENT_PLUGINS_SCHEMA,
  InvalidPluginError,
  SHIPPED,
  portableName,
  validRate,
  validatePluginPackage,
  type PluginAppConnector,
  type PluginManifest,
  type PluginMcpServer,
  type PluginPackage,
  type PluginProvenance,
  type PluginSkill,
  type PluginSpecialist,
} from "./plugins.js";
import { staysInside } from "@zhiyin/workspace-containment";

export const MCP_PLUGINS_SCHEMA =
  "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new InvalidPluginError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new InvalidPluginError(`${label} must not be empty.`);
  return value;
}

function optionalText(value: unknown, fallback: string, label: string): string {
  return value === undefined ? fallback : text(value, label);
}

function titleFromName(name: string): string {
  return name
    .split("-")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function resolvePackagePath(
  root: string,
  value: unknown,
  label: string,
): string {
  const path = text(value, label);
  if (!path.startsWith("./") && !path.startsWith(".\\"))
    throw new InvalidPluginError(
      `${label} must start with “./” and stay inside the plugin root.`,
    );
  const destination = resolve(root, path);
  if (!staysInside(root, destination))
    throw new InvalidPluginError(`${label} must stay inside the plugin root.`);
  return destination;
}

async function assertSafeTree(root: string): Promise<string> {
  const resolvedRoot = await realpath(root).catch(() => {
    throw new InvalidPluginError("The plugin directory could not be opened.");
  });
  if (!(await lstat(resolvedRoot)).isDirectory())
    throw new InvalidPluginError("The plugin source must be a directory.");

  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (!staysInside(resolvedRoot, path))
        throw new InvalidPluginError(
          "Plugin files must stay inside the plugin root.",
        );
      const status = await lstat(path);
      if (status.isSymbolicLink())
        throw new InvalidPluginError(
          "Plugin packages may not contain symbolic links.",
        );
      const canonical = await realpath(path);
      if (!staysInside(resolvedRoot, canonical))
        throw new InvalidPluginError(
          "Plugin files must stay inside the plugin root.",
        );
      if (status.isDirectory()) await visit(path);
    }
  };
  await visit(resolvedRoot);
  return resolvedRoot;
}

async function jsonFile(path: string, label: string): Promise<unknown> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch {
    throw new InvalidPluginError(`${label} could not be read.`);
  }
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new InvalidPluginError(`${label} is not valid JSON.`);
  }
}

function localId(value: unknown, label: string): string {
  const id = text(value, label);
  if (!portableName.test(id))
    throw new InvalidPluginError(`${label} “${id}” must be a portable name.`);
  return id;
}

function specialistsFrom(
  value: unknown,
  pluginName: string,
): readonly PluginSpecialist[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new InvalidPluginError("Zhiyin specialists must be an array.");
  return value.map((candidate, index) => {
    const specialist = record(candidate, `Specialist ${index + 1}`);
    const access = specialist["access"];
    if (access !== undefined && access !== "read" && access !== "change")
      throw new InvalidPluginError(
        `Specialist ${index + 1} access must be read or change.`,
      );
    const tools = specialist["tools"];
    if (
      tools !== undefined &&
      (!Array.isArray(tools) ||
        tools.length > 50 ||
        !tools.every(
          (name) =>
            typeof name === "string" &&
            name.trim().length > 0 &&
            name.length <= 128,
        ))
    )
      throw new InvalidPluginError(
        `Specialist ${index + 1} tools must be a list of at most 50 tool names.`,
      );
    return {
      id: `${pluginName}/${localId(specialist["id"], `Specialist ${index + 1} id`)}`,
      name: text(specialist["name"], `Specialist ${index + 1} name`),
      description: text(
        specialist["description"],
        `Specialist ${index + 1} description`,
      ),
      instructions: text(
        specialist["instructions"],
        `Specialist ${index + 1} instructions`,
      ),
      ...(access ? { access } : {}),
      ...(tools ? { tools: tools as string[] } : {}),
    };
  });
}

function appConnectorsFrom(
  value: unknown,
  pluginName: string,
): readonly PluginAppConnector[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new InvalidPluginError(
      "Zhiyin application connectors must be an array.",
    );
  return value.map((candidate, index) => {
    const label = `Application connector ${index + 1}`;
    const connector = record(candidate, label);
    return {
      id: `${pluginName}/${localId(connector["id"], `${label} id`)}`,
      connector: text(connector["connector"], `${label} key`),
      name: text(connector["name"], `${label} name`),
      description: text(connector["description"], `${label} description`),
      access: text(connector["access"], `${label} access`),
      dataDestination: text(
        connector["dataDestination"],
        `${label} data destination`,
      ),
    };
  });
}

type ParsedManifest = {
  readonly manifest: PluginManifest;
  readonly specialists: readonly PluginSpecialist[];
  readonly appConnectors: readonly PluginAppConnector[];
};

function manifestFrom(value: unknown, root: string): ParsedManifest {
  const raw = record(value, "plugin.json");
  if (raw["$schema"] !== AGENT_PLUGINS_SCHEMA)
    throw new InvalidPluginError("plugin.json uses an unsupported schema.");
  const name = text(raw["name"], "Plugin name");
  if (!portableName.test(name))
    throw new InvalidPluginError("Plugin names must use portable kebab-case.");
  const version = optionalText(raw["version"], "0.0.0", "Plugin version");
  const description = optionalText(
    raw["description"],
    `${titleFromName(name)} plugin.`,
    "Plugin description",
  );
  const authorValue = raw["author"];
  const author =
    authorValue === undefined
      ? { name: "Unknown publisher" }
      : {
          name: text(
            record(authorValue, "Plugin author")["name"],
            "Author name",
          ),
        };
  const rawExtensions =
    raw["extensions"] === undefined
      ? {}
      : record(raw["extensions"], "Plugin extensions");
  const rawOpenai =
    rawExtensions["com.openai"] === undefined
      ? {}
      : record(rawExtensions["com.openai"], "OpenAI extension");
  if (rawOpenai["hooks"] !== undefined)
    throw new InvalidPluginError(
      "Plugin lifecycle hooks are not supported by this Zhiyin build.",
    );
  if (rawOpenai["apps"] !== undefined)
    throw new InvalidPluginError(
      "Plugin UI apps are not supported by this Zhiyin build.",
    );
  const rawInterface =
    rawOpenai["interface"] === undefined
      ? {}
      : record(rawOpenai["interface"], "OpenAI interface");
  for (const key of ["composerIcon", "logo"])
    if (rawInterface[key] !== undefined)
      resolvePackagePath(root, rawInterface[key], `OpenAI interface ${key}`);
  if (rawInterface["screenshots"] !== undefined) {
    if (!Array.isArray(rawInterface["screenshots"]))
      throw new InvalidPluginError(
        "OpenAI interface screenshots must be an array.",
      );
    for (const screenshot of rawInterface["screenshots"])
      resolvePackagePath(root, screenshot, "OpenAI interface screenshot");
  }
  const rawZhiyin =
    rawExtensions["com.zhiyin"] === undefined
      ? {}
      : record(rawExtensions["com.zhiyin"], "Zhiyin extension");
  const prompts = rawInterface["defaultPrompt"];
  if (
    prompts !== undefined &&
    (!Array.isArray(prompts) ||
      prompts.some((prompt) => typeof prompt !== "string"))
  )
    throw new InvalidPluginError("Default prompts must be an array of text.");

  return {
    manifest: {
      $schema: AGENT_PLUGINS_SCHEMA,
      name,
      version,
      description,
      author,
      displayName: optionalText(
        rawInterface["displayName"],
        titleFromName(name),
        "Plugin display name",
      ),
      category: optionalText(
        rawInterface["category"],
        "Other",
        "Plugin category",
      ),
      defaultPrompts: (prompts as readonly string[] | undefined) ?? [],
      ...(rawZhiyin["accessSummary"] === undefined
        ? {}
        : {
            accessSummary: text(
              rawZhiyin["accessSummary"],
              "Plugin access summary",
            ),
          }),
      ...(rawZhiyin["dataDestination"] === undefined
        ? {}
        : {
            dataDestination: text(
              rawZhiyin["dataDestination"],
              "Plugin data destination",
            ),
          }),
    },
    specialists: specialistsFrom(rawZhiyin["specialists"], name),
    appConnectors: appConnectorsFrom(rawZhiyin["appConnectors"], name),
  };
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  )
    return trimmed.slice(1, -1);
  return trimmed;
}

async function skillsFrom(
  root: string,
  pluginName: string,
): Promise<PluginSkill[]> {
  const directory = resolve(root, "skills");
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return [];
    throw new InvalidPluginError(
      "The plugin skills directory could not be read.",
    );
  }
  const skills: PluginSkill[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (!entry.isDirectory())
      throw new InvalidPluginError(
        "Every entry in skills/ must be a skill directory.",
      );
    const source = await readFile(
      resolve(directory, entry.name, "SKILL.md"),
      "utf8",
    ).catch(() => {
      throw new InvalidPluginError(
        `Skill “${entry.name}” is missing SKILL.md.`,
      );
    });
    const lines = source.replaceAll("\r\n", "\n").split("\n");
    if (lines[0] !== "---")
      throw new InvalidPluginError(
        `Skill “${entry.name}” is missing YAML frontmatter.`,
      );
    const closing = lines.indexOf("---", 1);
    if (closing < 0)
      throw new InvalidPluginError(
        `Skill “${entry.name}” has unfinished YAML frontmatter.`,
      );
    const metadata = new Map<string, string>();
    for (const line of lines.slice(1, closing)) {
      const separator = line.indexOf(":");
      if (separator > 0)
        metadata.set(
          line.slice(0, separator).trim(),
          unquote(line.slice(separator + 1)),
        );
    }
    const name = text(metadata.get("name"), `Skill “${entry.name}” name`);
    if (!portableName.test(name))
      throw new InvalidPluginError(
        `Skill “${entry.name}” must use a portable name.`,
      );
    if (name !== entry.name)
      throw new InvalidPluginError(
        `Skill “${entry.name}” must be named after its directory.`,
      );
    const instructions = lines
      .slice(closing + 1)
      .join("\n")
      .trim();
    skills.push({
      id: `${pluginName}/${name}`,
      name,
      description: text(
        metadata.get("description"),
        `Skill “${entry.name}” description`,
      ),
      instructions: text(instructions, `Skill “${entry.name}” instructions`),
    });
  }
  return skills;
}

async function serversFrom(
  root: string,
  pluginName: string,
): Promise<PluginMcpServer[]> {
  const path = resolve(root, "mcp.json");
  let value: unknown;
  try {
    value = await jsonFile(path, "mcp.json");
  } catch (error) {
    if (
      error instanceof InvalidPluginError &&
      !(await lstat(path).catch(() => undefined))
    )
      return [];
    throw error;
  }
  const raw = record(value, "mcp.json");
  if (raw["$schema"] !== MCP_PLUGINS_SCHEMA)
    throw new InvalidPluginError("mcp.json uses an unsupported schema.");
  const servers = record(raw["mcpServers"], "mcp.json mcpServers");
  return Object.entries(servers)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, candidate]) => {
      if (!portableName.test(id))
        throw new InvalidPluginError(
          `MCP server “${id}” must use a portable name.`,
        );
      const server = record(candidate, `MCP server “${id}”`);
      if (server["type"] !== "streamable-http")
        throw new InvalidPluginError(
          `MCP server “${id}” uses a transport this Zhiyin build cannot run.`,
        );
      const url = text(server["url"], `MCP server “${id}” URL`);
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new InvalidPluginError(`MCP server “${id}” has an invalid URL.`);
      }
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password
      )
        throw new InvalidPluginError(
          `MCP server “${id}” must use an http(s) URL without credentials.`,
        );
      return {
        id: `${pluginName}/${id}`,
        name: optionalText(
          server["name"],
          titleFromName(id),
          `MCP server “${id}” name`,
        ),
        description: optionalText(
          server["description"],
          `Tools provided by ${titleFromName(id)}.`,
          `MCP server “${id}” description`,
        ),
        type: "streamable-http" as const,
        url,
        access: optionalText(
          server["access"],
          "May call the server's advertised tools after connection approval.",
          `MCP server “${id}” access`,
        ),
        dataDestination: optionalText(
          server["dataDestination"],
          parsed.origin,
          `MCP server “${id}” data destination`,
        ),
        ...requestRate(server["requestsPerMinute"], id),
        ...setupOf(server["setup"], id),
        ...readOnlyToolsOf(server["readOnlyTools"], id),
      };
    });
}

function readOnlyToolsOf(
  value: unknown,
  id: string,
): { readOnlyTools?: readonly string[] } {
  if (value === undefined) return {};
  if (
    !Array.isArray(value) ||
    !value.every(
      (name) => typeof name === "string" && name && name.trim() === name,
    )
  )
    throw new InvalidPluginError(
      `MCP server “${id}” read-only tools must be a list of tool names.`,
    );
  return { readOnlyTools: value as string[] };
}

function setupOf(value: unknown, id: string): { setup?: ConnectorSetup } {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InvalidPluginError(`MCP server “${id}” setup must be an object.`);
  const setup = value as Record<string, unknown>;
  if (!(ALLOWED_EXTERNAL_URLS as readonly unknown[]).includes(setup["url"]))
    throw new InvalidPluginError(
      `MCP server “${id}” setup page must be one Zhiyin can open.`,
    );
  const advice = setup["advice"];
  return {
    setup: {
      url: setup["url"] as string,
      keyName: text(setup["keyName"], `MCP server “${id}” setup key name`),
      ...(advice === undefined
        ? {}
        : { advice: text(advice, `MCP server “${id}” setup advice`) }),
    },
  };
}

function requestRate(
  value: unknown,
  id: string,
): { requestsPerMinute?: number } {
  if (value === undefined) return {};
  if (!validRate(value))
    throw new InvalidPluginError(
      `MCP server “${id}” requests per minute must be a positive whole number.`,
    );
  return { requestsPerMinute: value };
}

export async function loadPluginDirectory(
  sourceDirectory: string,
  provenance: PluginProvenance,
): Promise<PluginPackage> {
  if (!provenance.sourceId.trim())
    throw new InvalidPluginError("Plugin provenance needs a source identity.");
  const root = await assertSafeTree(sourceDirectory);
  const { manifest, specialists, appConnectors } = manifestFrom(
    await jsonFile(resolve(root, "plugin.json"), "plugin.json"),
    root,
  );
  const plugin: PluginPackage = {
    manifest,
    skills: await skillsFrom(root, manifest.name),
    specialists,
    mcpServers: await serversFrom(root, manifest.name),
    appConnectors,
    provenance,
  };
  validatePluginPackage(plugin);
  return plugin;
}

/**
 * The packages shipped with the application. `catalog.json` names them in
 * order; a package directory the catalog does not name, or a named package
 * that is missing, refuses the whole catalog rather than hiding a plugin.
 */
export async function loadBuiltInPlugins(
  directory: string,
): Promise<readonly PluginPackage[]> {
  const catalog = record(
    await jsonFile(join(directory, "catalog.json"), "Built-in catalog"),
    "Built-in catalog",
  );
  const names = catalog["plugins"];
  if (
    !Array.isArray(names) ||
    !names.every((name) => typeof name === "string" && portableName.test(name))
  )
    throw new InvalidPluginError(
      "The built-in catalog must list portable plugin names.",
    );
  if (new Set(names).size !== names.length)
    throw new InvalidPluginError(
      "The built-in catalog names a plugin more than once.",
    );
  const present = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const unlisted = present.filter((name) => !names.includes(name));
  if (unlisted.length)
    throw new InvalidPluginError(
      `Built-in plugin “${unlisted[0]}” is not listed in the catalog.`,
    );
  const plugins: PluginPackage[] = [];
  for (const name of names as string[]) {
    if (!present.includes(name))
      throw new InvalidPluginError(
        `The built-in catalog names “${name}”, which is missing.`,
      );
    const plugin = await loadPluginDirectory(join(directory, name), SHIPPED);
    if (plugin.manifest.name !== name)
      throw new InvalidPluginError(
        `Built-in plugin directory “${name}” declares “${plugin.manifest.name}”.`,
      );
    plugins.push(plugin);
  }
  return plugins;
}
