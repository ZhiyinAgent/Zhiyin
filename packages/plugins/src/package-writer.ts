import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AuthoredMcpServerDraft,
  AuthoredSkillDraft,
  AuthoredSpecialistDraft,
} from "@zhiyin/contract";
import { AGENT_PLUGINS_SCHEMA } from "./index.js";
import { MCP_PLUGINS_SCHEMA } from "./package-loader.js";

/**
 * The inverse of `package-loader.ts`: turns an in-app edited draft into the
 * same portable directory shape a hand-authored plugin package would use, so
 * it can be installed or updated through the existing atomic pipeline
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

async function writeSkill(
  root: string,
  skill: AuthoredSkillDraft,
): Promise<void> {
  const directory = join(root, "skills", skill.id);
  await mkdir(directory, { recursive: true });
  const frontmatter = [
    "---",
    `name: ${singleLine(skill.id)}`,
    `description: ${singleLine(skill.description)}`,
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
  await mkdir(root, { recursive: true });
  await writeManifest(root, draft);
  await Promise.all(draft.skills.map((skill) => writeSkill(root, skill)));
  await writeMcpServers(root, draft.mcpServers);
}
