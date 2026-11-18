import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { LineCounter, parseDocument } from "yaml";
import { ALLOWED_EXTERNAL_URLS, type ConnectorSetup } from "@zhiyin/contract";
import {
  AGENT_PLUGINS_SCHEMA,
  InvalidPluginError,
  SHIPPED,
  portableName,
  validRate,
  validToolMinutes,
  toolMinutesProblem,
  validatePluginPackage,
  type PluginAppConnector,
  type PluginManifest,
  type PluginMcpServer,
  type PluginPackage,
  type PluginProvenance,
  type PluginSkill,
  type PluginSpecialist,
} from "./plugins.js";
import { toolEffectsOf } from "./tool-effects.js";
import { realStaysInside, staysInside } from "@zhiyin/workspace-containment";

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

/**
 * Far more than a plugin of skills, specialists and connectors needs, so the
 * walk of a package stays short whatever a folder holds.
 */
const maximumEntries = 2_000;

async function assertSafeTree(root: string): Promise<string> {
  const resolvedRoot = await realpath(root).catch(() => {
    throw new InvalidPluginError("The plugin directory could not be opened.");
  });
  if (!(await lstat(resolvedRoot)).isDirectory())
    throw new InvalidPluginError("The plugin source must be a directory.");

  let entries = 0;
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      entries += 1;
      if (entries > maximumEntries)
        throw new InvalidPluginError(
          `A plugin package may hold at most ${maximumEntries.toLocaleString("en-US")} files and folders.`,
        );
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
      if (!realStaysInside(resolvedRoot, canonical))
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
    return JSON.parse(withoutMark(source)) as unknown;
  } catch {
    throw new InvalidPluginError(`${label} is not valid JSON.`);
  }
}

/** A file as written, without the byte-order mark some editors put first. */
function withoutMark(source: string): string {
  return source.startsWith("\uFEFF") ? source.slice(1) : source;
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
      ...stagesOf(rawZhiyin["stages"]),
    },
    specialists: specialistsFrom(rawZhiyin["specialists"], name),
    appConnectors: appConnectorsFrom(rawZhiyin["appConnectors"], name),
  };
}

/** The stages a plugin declares for its skills, as a list of text. */
function stagesOf(value: unknown): { stages?: readonly string[] } {
  if (value === undefined) return {};
  if (!Array.isArray(value) || !value.every((one) => typeof one === "string"))
    throw new InvalidPluginError("Plugin stages must be a list of words.");
  return { stages: value as string[] };
}

/**
 * How a skill's frontmatter is read: YAML 1.2 with only maps, lists and text,
 * so a tag names no type and nothing is converted; keys are text, each given
 * once, and no merge key copies one map into another.
 */
const FRONTMATTER = {
  schema: "failsafe",
  merge: false,
  stringKeys: true,
  uniqueKeys: true,
  prettyErrors: false,
} as const;

/**
 * A skill's frontmatter, from the lines between its two `---` lines: each
 * top-level key's value, and the entries of its `metadata` map, which must be
 * text. YAML that does not parse and a tag each refuse the skill with the line
 * of SKILL.md they are on, and so does an alias.
 */
function frontmatter(
  source: string,
  skill: string,
): {
  readonly fields: ReadonlyMap<string, unknown>;
  readonly metadata: ReadonlyMap<string, string>;
} {
  const lineCounter = new LineCounter();
  const document = parseDocument(source, { ...FRONTMATTER, lineCounter });
  const problem = document.errors[0] ?? document.warnings[0];
  if (problem) {
    // The first line of SKILL.md is the opening `---`.
    const line = lineCounter.linePos(problem.pos[0]).line + 1;
    throw new InvalidPluginError(
      `Skill “${skill}” has frontmatter that is not valid YAML, at line ${line} of SKILL.md: ${problem.message}.${
        problem.code === "BLOCK_AS_IMPLICIT_KEY"
          ? " A value holding a colon and a space is written in quotes."
          : ""
      }`,
    );
  }
  let value: unknown;
  try {
    // No alias is followed, so no value can be repeated into a large one.
    value = document.toJS({ maxAliasCount: 0, mapAsMap: true });
  } catch {
    throw new InvalidPluginError(
      `Skill “${skill}” repeats a value in its frontmatter by an alias: write each value out.`,
    );
  }
  if (value === null) return { fields: new Map(), metadata: new Map() };
  if (!(value instanceof Map))
    throw new InvalidPluginError(
      `Skill “${skill}” frontmatter must be a map of keys to values.`,
    );
  // Text is read without the line break a `>` or `|` block ends with.
  const fields = new Map(
    [...(value as ReadonlyMap<string, unknown>)].map(([key, field]) => [
      key,
      typeof field === "string" ? field.trim() : field,
    ]),
  );
  const declared = fields.get("metadata");
  const metadata = new Map<string, string>();
  // An empty `metadata:` holds no entries.
  if (declared === undefined || declared === "") return { fields, metadata };
  if (!(declared instanceof Map))
    throw new InvalidPluginError(
      `Skill “${skill}” metadata must be a map of names to text.`,
    );
  for (const [key, entry] of declared as ReadonlyMap<string, unknown>) {
    if (typeof entry !== "string")
      throw new InvalidPluginError(
        `Skill “${skill}” metadata “${key}” must be text.`,
      );
    metadata.set(key, entry.trim());
  }
  return { fields, metadata };
}

/**
 * The skills a skill's metadata names, apart by spaces or commas, as ids: a
 * name alone is a skill of the same plugin, and `plugin/skill` one of another.
 */
function skillIds(
  value: string | undefined,
  pluginName: string,
  skillName: string,
): readonly string[] {
  if (!value?.trim()) return [];
  return value
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((named) => {
      const parts = named.split("/");
      if (parts.length > 2 || !parts.every((part) => portableName.test(part)))
        throw new InvalidPluginError(
          `Skill “${skillName}” names “${named}”, which is not a skill's name.`,
        );
      return parts.length === 2 ? named : `${pluginName}/${named}`;
    });
}

/**
 * A domain is a short word, in any script, with hyphens inside it: letters in
 * lower case where the script has case, the marks some scripts write letters
 * with, and digits.
 */
const domainWord =
  /^[\p{Ll}\p{Lo}\p{Lm}\p{N}][\p{Ll}\p{Lo}\p{Lm}\p{M}\p{N}]*(?:-[\p{Ll}\p{Lo}\p{Lm}\p{N}][\p{Ll}\p{Lo}\p{Lm}\p{M}\p{N}]*)*$/u;
const DOMAIN_LENGTH = 32;
const GATE_LENGTH = 200;

function words(value: string | undefined): readonly string[] {
  return value?.split(/[\s,]+/).filter(Boolean) ?? [];
}

function skillDomains(
  value: string | undefined,
  skillName: string,
): readonly string[] {
  const domains = words(value);
  for (const domain of domains)
    if (!domainWord.test(domain) || [...domain].length > DOMAIN_LENGTH)
      throw new InvalidPluginError(
        `Skill “${skillName}” names the domain “${domain}”: a domain is one word, lower-case where its script has case, of at most ${DOMAIN_LENGTH} characters, with hyphens inside it.`,
      );
  return domains;
}

function skillGate(
  value: string | undefined,
  skillName: string,
): string | undefined {
  const gate = value?.trim();
  if (!gate) return undefined;
  if (/[\r\n]/.test(gate))
    throw new InvalidPluginError(
      `Skill “${skillName}” gives a gate of more than one line: a gate is one sentence.`,
    );
  if ([...gate].length > GATE_LENGTH)
    throw new InvalidPluginError(
      `Skill “${skillName}” gives a gate longer than ${GATE_LENGTH} characters: a gate is one sentence.`,
    );
  return gate;
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
    const lines = withoutMark(source).replaceAll("\r\n", "\n").split("\n");
    if (lines[0] !== "---")
      throw new InvalidPluginError(
        `Skill “${entry.name}” is missing YAML frontmatter.`,
      );
    const closing = lines.indexOf("---", 1);
    if (closing < 0)
      throw new InvalidPluginError(
        `Skill “${entry.name}” has unfinished YAML frontmatter.`,
      );
    const { fields, metadata } = frontmatter(
      lines.slice(1, closing).join("\n"),
      entry.name,
    );
    const name = text(fields.get("name"), `Skill “${entry.name}” name`);
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
    const shown = metadata.get("display-name")?.trim();
    const needs = skillIds(metadata.get("needs"), pluginName, name);
    const worksWith = skillIds(metadata.get("works-with"), pluginName, name);
    const stages = words(metadata.get("stage"));
    const domains = skillDomains(metadata.get("domain"), name);
    const gate = skillGate(metadata.get("gate"), name);
    skills.push({
      id: `${pluginName}/${name}`,
      name: shown || name,
      description: text(
        fields.get("description"),
        `Skill “${entry.name}” description`,
      ),
      instructions: text(instructions, `Skill “${entry.name}” instructions`),
      ...(needs.length ? { needs } : {}),
      ...(worksWith.length ? { worksWith } : {}),
      ...(stages.length ? { stages } : {}),
      ...(domains.length ? { domains } : {}),
      ...(gate ? { gate } : {}),
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
      // The address is read as written; the validator says what it may be.
      const url = text(server["url"], `MCP server “${id}” URL`);
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
          URL.canParse(url) ? new URL(url).origin : url,
          `MCP server “${id}” data destination`,
        ),
        ...requestRate(server["requestsPerMinute"], id),
        ...toolMinutesOf(server["toolMinutes"], id),
        ...setupOf(server["setup"], id),
        ...readOnlyToolsOf(server["readOnlyTools"], id),
        ...toolEffectsOf(server["toolEffects"], id),
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

function toolMinutesOf(
  value: unknown,
  id: string,
): { toolMinutes?: Readonly<Record<string, number>> } {
  if (value === undefined) return {};
  if (!validToolMinutes(value))
    throw new InvalidPluginError(toolMinutesProblem(id));
  return { toolMinutes: value };
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
