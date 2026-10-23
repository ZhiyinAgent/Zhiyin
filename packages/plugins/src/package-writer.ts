import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AuthoredMcpServerDraft,
  AuthoredSkillDraft,
  AuthoredSpecialistDraft,
} from "@zhiyin/contract";
import {
  AGENT_PLUGINS_SCHEMA,
  InvalidPluginError,
  portableName,
} from "./plugins.js";
import { MCP_PLUGINS_SCHEMA } from "./package-loader.js";

/**
 * The inverse of the package loader: turns an in-app edited draft into the
 * same portable directory shape a hand-authored plugin package would use, so
 * it can be installed or updated through the store's atomic pipeline
 * (`FilePluginStore`) without that pipeline knowing authoring exists.
 */

export type AuthoredPluginDraft = {
  readonly name: string;
  readonly displayName: string;
  readonly version: string;
  readonly description: string;
  readonly skills: readonly AuthoredSkillDraft[];
  readonly specialists: readonly AuthoredSpecialistDraft[];
  readonly mcpServers: readonly AuthoredMcpServerDraft[];
};

/** A frontmatter value must stay on one line for the loader's line-based parser. */
function singleLine(value: string): string {
  return value.replace(/\r\n|\r|\n/g, " ").trim();
}

/** A value on one line, quoted as YAML reads it whatever it holds. */
function quoted(value: string): string {
  return `"${singleLine(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

async function writeSkill(
  root: string,
  skill: AuthoredSkillDraft,
): Promise<void> {
  // The name becomes a folder, so it is checked before it is used as one.
  if (!portableName.test(skill.id))
    throw new InvalidPluginError(
      `Skill “${skill.id}” must use a portable name.`,
    );
  const directory = join(root, "skills", skill.id);
  await mkdir(directory, { recursive: true });
  const frontmatter = [
    "---",
    `name: ${singleLine(skill.id)}`,
    `description: ${quoted(skill.description)}`,
    // The person's own name, which the package format's `name` cannot hold.
    ...(skill.name && skill.name.trim() !== skill.id
      ? ["metadata:", `  display-name: ${quoted(skill.name)}`]
      : []),
    "---",
    "",
    skill.instructions.trim(),
    "",
  ].join("\n");
  await writeFile(join(directory, "SKILL.md"), frontmatter, "utf8");
}

async function writeManifest(
  root: string,
  draft: AuthoredPluginDraft,
): Promise<void> {
  const manifest = {
    $schema: AGENT_PLUGINS_SCHEMA,
    name: draft.name,
    version: draft.version,
    description: draft.description,
    author: { name: "You" },
    extensions: {
      "com.openai": {
        interface: {
          displayName: draft.displayName,
          category: "Other",
        },
      },
      ...(draft.specialists.length
        ? {
            "com.zhiyin": {
              specialists: draft.specialists.map((specialist) => ({
                id: specialist.id,
                name: specialist.name,
                description: specialist.description,
                instructions: specialist.instructions,
                ...(specialist.access ? { access: specialist.access } : {}),
                ...(specialist.tools ? { tools: specialist.tools } : {}),
              })),
            },
          }
        : {}),
    },
  };
  await writeFile(
    join(root, "plugin.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
}

async function writeMcpServers(
  root: string,
  servers: readonly AuthoredMcpServerDraft[],
): Promise<void> {
  if (!servers.length) return;
  const mcpServers = Object.fromEntries(
    servers.map((server) => [
      server.id,
      {
        type: "streamable-http" as const,
        url: server.url,
        name: server.name,
        description: server.description,
        ...(server.access ? { access: server.access } : {}),
        ...(server.dataDestination
          ? { dataDestination: server.dataDestination }
          : {}),
      },
    ]),
  );
  await writeFile(
    join(root, "mcp.json"),
    JSON.stringify({ $schema: MCP_PLUGINS_SCHEMA, mcpServers }, null, 2),
    "utf8",
  );
}

export async function writePluginDirectory(
  root: string,
  draft: AuthoredPluginDraft,
): Promise<void> {
  // Two under one name would be written over each other.
  const ids = [...draft.skills, ...draft.specialists, ...draft.mcpServers].map(
    (component) => component.id,
  );
  const twice = ids.find((id, at) => ids.indexOf(id) !== at);
  if (twice !== undefined)
    throw new InvalidPluginError(
      `Component “${twice}” is registered more than once.`,
    );
  await mkdir(root, { recursive: true });
  await writeManifest(root, draft);
  await Promise.all(draft.skills.map((skill) => writeSkill(root, skill)));
  await writeMcpServers(root, draft.mcpServers);
}
