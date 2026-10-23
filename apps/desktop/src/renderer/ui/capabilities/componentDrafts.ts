/**
 * An authored plugin's contents as the component editor edits them: one
 * component as a draft, and the whole contents again once a draft is saved
 * or removed.
 */

import {
  holdsEmoji,
  portableNameFor,
  type AuthoredPluginContents,
  type PluginComponentState,
} from "@zhiyin/contract";

export type SkillDraft = {
  readonly kind: "skill";
  readonly id: string;
  /** As the person wrote it, in any script; the id is made from it once. */
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
};

export type SpecialistDraft = {
  readonly kind: "specialist";
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
};

export type ConnectorDraft = {
  readonly kind: "connection";
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly access: string;
  readonly dataDestination: string;
};

export type ComponentDraft = SkillDraft | SpecialistDraft | ConnectorDraft;

/**
 * The id a name becomes: lowercase words joined by hyphens, or, for a name
 * with no Latin letters or digits, the kind and a code made from the name.
 */
export function slugify(
  value: string,
  kind: "skill" | "specialist" | "connector",
): string {
  return portableNameFor(value, kind);
}

/**
 * What is wrong with a name a person gives a plugin or a component, if
 * anything. A name is saved under its letters and digits, so emoji alone
 * could not tell two apart.
 */
export function nameProblem(name: string): string | undefined {
  if (!name.trim()) return "Enter a name.";
  if (holdsEmoji(name)) return "A name can't contain emoji.";
  return undefined;
}

/** The part of a component id after its plugin's name. */
export function localIdOf(pluginId: string, fullId: string): string {
  const prefix = `${pluginId}/`;
  return fullId.startsWith(prefix) ? fullId.slice(prefix.length) : fullId;
}

function emptyDraft(kind: PluginComponentState["kind"]): ComponentDraft {
  if (kind === "skill")
    return { kind, id: "", name: "", description: "", instructions: "" };
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
  if (skill) return { kind: "skill", ...skill, name: skill.name ?? skill.id };
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

/** What kind of component already has this id in the plugin, if one does. */
export function holderOf(
  contents: AuthoredPluginContents,
  localId: string,
): "skill" | "specialist" | "connector" | undefined {
  if (contents.skills.some((item) => item.id === localId)) return "skill";
  if (contents.specialists.some((item) => item.id === localId))
    return "specialist";
  if (contents.mcpServers.some((item) => item.id === localId))
    return "connector";
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
    const { id, name, description, instructions } = saved;
    return {
      ...without,
      skills: [
        ...without.skills,
        {
          id,
          ...(name.trim() && name.trim() !== id ? { name: name.trim() } : {}),
          description,
          instructions,
        },
      ],
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
