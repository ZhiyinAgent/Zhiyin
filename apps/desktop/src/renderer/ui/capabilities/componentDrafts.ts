/**
 * An authored plugin's contents as the component editor edits them: one
 * component as a draft, and the whole contents again once a draft is saved
 * or removed.
 */

import type {
  AuthoredPluginContents,
  PluginComponentState,
} from "@zhiyin/contract";
import type { ComponentDraft } from "./ComponentEditor.js";

/** The part of a component id after its plugin's name. */
export function localIdOf(pluginId: string, fullId: string): string {
  const prefix = `${pluginId}/`;
  return fullId.startsWith(prefix) ? fullId.slice(prefix.length) : fullId;
}

function emptyDraft(kind: PluginComponentState["kind"]): ComponentDraft {
  if (kind === "skill")
    return { kind, id: "", description: "", instructions: "" };
  if (kind === "specialist")
    return { kind, id: "", name: "", description: "", instructions: "" };
  return { kind, id: "", name: "", url: "", access: "", dataDestination: "" };
}

export function draftFromContents(
  contents: AuthoredPluginContents,
  localId: string | undefined,
  kind: PluginComponentState["kind"],
): ComponentDraft | undefined {
  if (localId === undefined) return emptyDraft(kind);
  const skill = contents.skills.find((item) => item.id === localId);
  if (skill) return { kind: "skill", ...skill };
  const specialist = contents.specialists.find((item) => item.id === localId);
  if (specialist) return { kind: "specialist", ...specialist };
  const server = contents.mcpServers.find((item) => item.id === localId);
  if (server)
    return {
      kind: "connection",
      id: server.id,
      name: server.name,
      url: server.url,
      access: server.access ?? "",
      dataDestination: server.dataDestination ?? "",
    };
  return undefined;
}

/** A plugin's whole content with one component replaced, added, or removed. */
export function nextContents(
  contents: AuthoredPluginContents,
  removedLocalId: string | undefined,
  saved: ComponentDraft | undefined,
): AuthoredPluginContents {
  const without = {
    ...contents,
    skills: contents.skills.filter((item) => item.id !== removedLocalId),
    specialists: contents.specialists.filter(
      (item) => item.id !== removedLocalId,
    ),
    mcpServers: contents.mcpServers.filter(
      (item) => item.id !== removedLocalId,
    ),
  };
  if (saved?.kind === "skill") {
    const { id, description, instructions } = saved;
    return {
      ...without,
      skills: [...without.skills, { id, description, instructions }],
    };
  }
  if (saved?.kind === "specialist") {
    const { id, name, description, instructions } = saved;
    return {
      ...without,
      specialists: [
        ...without.specialists,
        { id, name, description, instructions },
      ],
    };
  }
  if (saved?.kind === "connection")
    return {
      ...without,
      mcpServers: [
        ...without.mcpServers,
        {
          id: saved.id,
          name: saved.name,
          description: saved.name,
          url: saved.url,
          ...(saved.access ? { access: saved.access } : {}),
          ...(saved.dataDestination
            ? { dataDestination: saved.dataDestination }
            : {}),
        },
      ],
    };
  return without;
}
