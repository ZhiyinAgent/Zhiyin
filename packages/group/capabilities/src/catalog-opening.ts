/**
 * Reading one catalog entry whole (ADR 0017, ADR 0016): a skill or a toolkit
 * is Zhiyin's guidance, a page, a function or an API change is reference. An
 * entry of a switched-off plugin is refused with the reason ADR 0017 gives.
 */

import {
  PLUGIN_SWITCHED_OFF,
  type KnowledgeSource,
  type ToolSpec,
} from "@zhiyin/contract";
import type { PluginView } from "@zhiyin/plugins";
import {
  remoteEntry,
  remoteEntryId,
  skillEntry,
  skillEntryId,
  toolkitEntry,
  toolkitsOfPlugin,
  toolList,
  type DescribedTools,
} from "./catalog.js";
import type { CatalogOpening } from "./roles.js";
import { skillGuidance } from "./skill-answer.js";

type RemoteView = PluginView["mcpServers"][number];

export type OpeningSources = {
  readonly views: readonly PluginView[];
  readonly described: DescribedTools;
  readonly knowledge: readonly KnowledgeSource[];
  /** Reaches one remote connector for the conversation, and lists its tools. */
  readonly reach: (server: RemoteView) => Promise<readonly ToolSpec[]>;
};

const unknown = (id: string): CatalogOpening => ({
  ok: false,
  reason: `Nothing in the catalog has the id “${id}”. Use find to look up ids.`,
});

const switchedOff: CatalogOpening = { ok: false, reason: PLUGIN_SWITCHED_OFF };

function openSkill(id: string, views: readonly PluginView[]): CatalogOpening {
  for (const view of views) {
    const skill = view.skills.find((item) => skillEntryId(item) === id);
    if (!skill) continue;
    if (!view.enabled) return switchedOff;
    if (!skill.enabled) return unknown(id);
    const plugin = view.manifest.name;
    return {
      ok: true,
      entry: skillEntry(view, skill),
      text: skillGuidance(skill, plugin, views),
      voice: "guidance",
      plugin,
    };
  }
  return unknown(id);
}

async function openToolkit(
  id: string,
  { views, described, knowledge, reach }: OpeningSources,
): Promise<CatalogOpening> {
  for (const view of views) {
    const plugin = view.manifest.name;
    const server = view.mcpServers.find(
      (item) => item.enabled && remoteEntryId(item) === id,
    );
    const { toolkits, refused } = toolkitsOfPlugin(view, described);
    const toolkit = toolkits.find((item) => item.id === id);
    if (!server && !toolkit) continue;
    if (!view.enabled) return switchedOff;
    if (refused) return { ok: false, reason: refused };
    if (toolkit)
      return {
        ok: true,
        entry: toolkitEntry(toolkit, knowledge),
        text: toolList(toolkit.tools),
        voice: "guidance",
        plugin,
        tools: toolkit.tools,
      };
    // A remote connector's tools are its plugin's core tools, offered once
    // the plugin is active: the opening reaches it and says what it offers.
    const tools = await reach(server!).catch(() => []);
    if (!tools.length)
      return {
        ok: false,
        reason: `${server!.name} offers no tools right now. Tell the person to check it on the Plugins page.`,
      };
    return {
      ok: true,
      entry: remoteEntry(view, server!),
      text: toolList(tools),
      voice: "guidance",
      plugin,
    };
  }
  return unknown(id);
}

async function openReference(
  id: string,
  { views, knowledge }: OpeningSources,
): Promise<CatalogOpening> {
  const enabled = new Set(
    views.filter((view) => view.enabled).map((view) => view.manifest.name),
  );
  for (const source of knowledge.filter((item) => enabled.has(item.plugin))) {
    const page = await source.page(id).catch(() => undefined);
    if (page)
      return {
        ok: true,
        entry: page.entry,
        text: page.text,
        voice: "reference",
        plugin: source.plugin,
      };
  }
  // Only listed entries are looked for in a switched-off plugin: reading a
  // page may build it, which is not done for a plugin nobody may use.
  for (const source of knowledge.filter((item) => !enabled.has(item.plugin))) {
    const entries = await source.entries().catch(() => []);
    if (entries.some((entry) => entry.id === id)) return switchedOff;
  }
  return unknown(id);
}

export async function openEntry(
  id: string,
  sources: OpeningSources,
): Promise<CatalogOpening> {
  const kind = id.slice(0, Math.max(id.indexOf(":"), 0));
  if (kind === "skill") return openSkill(id, sources.views);
  if (kind === "toolkit") return openToolkit(id, sources);
  if (kind === "doc" || kind === "function" || kind === "break")
    return openReference(id, sources);
  return unknown(id);
}
