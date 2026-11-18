/**
 * The catalog of what enabled plugins bring (ADR 0017), assembled from the
 * plugins' skills, the toolkits their built-in connections' tools name, their
 * remote connectors and the knowledge the composition root hands in. Pure, so
 * the assembling can be tested against fabricated inputs.
 */

import {
  TOOLKIT_SIZE,
  type CatalogEntry,
  type KnowledgeSource,
  type ToolSpec,
} from "@zhiyin/contract";
import type { PluginView } from "@zhiyin/plugins";
import type { OfferedToolkit } from "./roles.js";

/** Each built-in connection's tools, by connection id. */
export type DescribedTools = ReadonlyMap<string, readonly ToolSpec[]>;

type SkillView = PluginView["skills"][number];
type RemoteView = PluginView["mcpServers"][number];

/** A plugin's toolkits, or why they are refused. */
type PluginToolkits = {
  readonly toolkits: readonly OfferedToolkit[];
  readonly refused?: string;
};

export const skillEntryId = (skill: SkillView): string => `skill:${skill.id}`;
export const remoteEntryId = (server: RemoteView): string =>
  `toolkit:${server.id}`;

/**
 * The toolkits a plugin's built-in connections' tools name. A plugin of
 * `TOOLKIT_SIZE` tools or fewer in all is all core and has none.
 */
export function toolkitsOfPlugin(
  view: PluginView,
  described: DescribedTools,
): PluginToolkits {
  const plugin = view.manifest.name;
  const tools = view.appConnectors
    .filter((connector) => connector.enabled)
    .flatMap((connector) => described.get(connector.connector) ?? []);
  if (tools.length <= TOOLKIT_SIZE) return { toolkits: [] };
  const grouped = new Map<string, ToolSpec[]>();
  for (const tool of tools) {
    if (!tool.toolkit) continue;
    const toolkit = `${plugin}/${tool.toolkit}`;
    const members = grouped.get(toolkit) ?? [];
    members.push({ ...tool, toolkit });
    grouped.set(toolkit, members);
  }
  const toolkits = [...grouped].map(([toolkit, members]) => ({
    id: `toolkit:${toolkit}`,
    plugin,
    tools: members,
  }));
  const crowded = toolkits.find(
    (toolkit) => toolkit.tools.length > TOOLKIT_SIZE,
  );
  return crowded
    ? {
        toolkits,
        refused: `The toolkit “${crowded.id}” holds ${crowded.tools.length} tools; a toolkit holds at most ${TOOLKIT_SIZE}.`,
      }
    : { toolkits };
}

/** The toolkits of the enabled plugins, or the first refusal among them. */
export function enabledToolkits(
  views: readonly PluginView[],
  described: DescribedTools,
): PluginToolkits {
  const each = views
    .filter((view) => view.enabled)
    .map((view) => toolkitsOfPlugin(view, described));
  const refused = each.find((item) => item.refused)?.refused;
  return {
    toolkits: each.flatMap((item) => item.toolkits),
    ...(refused ? { refused } : {}),
  };
}

/** A plugin's toolkits by catalog id, its remote connectors' included. */
export function toolkitIdsOf(
  view: PluginView,
  described: DescribedTools,
): readonly string[] {
  return [
    ...toolkitsOfPlugin(view, described).toolkits.map((toolkit) => toolkit.id),
    ...view.mcpServers
      .filter((server) => server.enabled)
      .map((server) => remoteEntryId(server)),
  ];
}

export function skillEntry(view: PluginView, skill: SkillView): CatalogEntry {
  const terms = [...(skill.stages ?? []), ...(skill.domains ?? [])];
  return {
    id: skillEntryId(skill),
    kind: "skill",
    title: skill.name,
    summary: skill.description,
    plugin: view.manifest.name,
    ...(terms.length ? { terms } : {}),
  };
}

function parameterNames(tool: ToolSpec): readonly string[] {
  const properties = (tool.inputSchema as { properties?: unknown }).properties;
  return properties && typeof properties === "object"
    ? Object.keys(properties)
    : [];
}

/**
 * A toolkit in its plugin's own words, or, where nothing describes it, by its
 * id and its tools' labels.
 */
export function toolkitEntry(
  toolkit: OfferedToolkit,
  knowledge: readonly KnowledgeSource[],
): CatalogEntry {
  const local = toolkit.id.slice(`toolkit:${toolkit.plugin}/`.length);
  const declared = knowledge
    .filter((source) => source.plugin === toolkit.plugin)
    .flatMap((source) => source.toolkits)
    .find((item) => item.id === local);
  const labels = toolkit.tools.map((tool) => tool.label ?? tool.name);
  return {
    id: toolkit.id,
    kind: "toolkit",
    title: declared?.title ?? local,
    summary: declared?.summary ?? labels.join(", "),
    plugin: toolkit.plugin,
    terms: toolkit.tools.flatMap((tool) => [
      tool.name,
      ...(tool.label ? [tool.label] : []),
      ...parameterNames(tool),
    ]),
  };
}

/** A remote connector, one entry that is reached only once it is opened. */
export function remoteEntry(
  view: PluginView,
  server: RemoteView,
): CatalogEntry {
  return {
    id: remoteEntryId(server),
    kind: "toolkit",
    title: server.name,
    summary: server.description,
    plugin: view.manifest.name,
  };
}

/** The knowledge sources of plugins in `plugins`. */
function knowledgeOf(
  knowledge: readonly KnowledgeSource[],
  plugins: ReadonlySet<string>,
): readonly KnowledgeSource[] {
  return knowledge.filter((source) => plugins.has(source.plugin));
}

/** Every entry the enabled plugins bring. */
export async function catalogEntries(
  views: readonly PluginView[],
  toolkits: readonly OfferedToolkit[],
  knowledge: readonly KnowledgeSource[],
): Promise<readonly CatalogEntry[]> {
  const enabled = views.filter((view) => view.enabled);
  const sources = knowledgeOf(
    knowledge,
    new Set(enabled.map((view) => view.manifest.name)),
  );
  const known = await Promise.all(
    // A source that cannot list its pages offers none, rather than failing
    // the search.
    sources.map((source) => source.entries().catch(() => [])),
  );
  return [
    ...enabled.flatMap((view) =>
      view.skills
        .filter((skill) => skill.enabled)
        .map((skill) => skillEntry(view, skill)),
    ),
    ...toolkits.map((toolkit) => toolkitEntry(toolkit, knowledge)),
    ...enabled.flatMap((view) =>
      view.mcpServers
        .filter((server) => server.enabled)
        .map((server) => remoteEntry(view, server)),
    ),
    ...known.flat(),
  ];
}

/** Everything about the entries an index ranks by, to tell when it must be built again. */
export function catalogSignature(entries: readonly CatalogEntry[]): string {
  return entries
    .map((entry) =>
      [
        entry.id,
        entry.kind,
        entry.plugin,
        entry.title,
        entry.summary,
        ...(entry.terms ?? []),
      ].join("\u0000"),
    )
    .join("\n");
}

/** A toolkit's tools as a short list: each by name, with the first line of what it does. */
export function toolList(tools: readonly ToolSpec[]): string {
  return tools
    .map((tool) => {
      const line = tool.description.trim().split("\n")[0]!.trim();
      return line ? `${tool.name}: ${line}` : tool.name;
    })
    .join("\n");
}
