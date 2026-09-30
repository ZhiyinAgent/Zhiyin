/** The outcome of asking for a local plugin package directory and applying it. */
export type PluginSourceOutcome =
  | { readonly status: "applied" }
  | { readonly status: "cancelled" }
  | { readonly status: "failed"; readonly reason: string };

export type PluginComponentStatus =
  "ready" | "off" | "setup-required" | "failed" | "unavailable";

/**
 * How a person changes a component's content: in place (a plugin made in the
 * app), as an edit layered over shipped or imported content, or not at all
 * (a connector's endpoint belongs to its package).
 */
export type ComponentEditing = "authored" | "override" | "none";

/** One program a connector needs, as a person is told about it. */
export type ToolchainDownload = {
  readonly name: string;
  readonly version: string;
  readonly bytes: number;
  readonly source: string;
};

/** The external programs an application connector needs, installed on request. */
export type ToolchainState =
  | { readonly status: "ready" }
  | {
      readonly status: "missing";
      /** Everything installing downloads, stated before a person agrees. */
      readonly downloads: readonly ToolchainDownload[];
    }
  | { readonly status: "installing" }
  | { readonly status: "failed"; readonly reason: string };

export type PluginComponentState = {
  /** `<plugin>/<component>`. */
  readonly id: string;
  readonly kind: "skill" | "specialist" | "connection";
  readonly name: string;
  readonly description: string;
  /** The component's own switch, kept while its plugin is off. */
  readonly enabled: boolean;
  readonly status: PluginComponentStatus;
  readonly editing: ComponentEditing;
  /** A person's edit is in effect. */
  readonly overridden?: boolean;
  /** The package now ships different content than the edit replaced. */
  readonly shippedChanged?: boolean;
  /** Provided by the application rather than a remote server. */
  readonly appConnector?: boolean;
  readonly toolchain?: ToolchainState;
  readonly detail?: string;
  readonly access?: string;
  readonly dataDestination?: string;
};

/** A skill's or specialist's full content, for reading or editing it. */
export type ComponentContent = {
  readonly id: string;
  readonly kind: "skill" | "specialist";
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly editing: "authored" | "override";
  /** Present while an edit is in effect: what the package ships. */
  readonly shipped?: {
    readonly name: string;
    readonly description: string;
    readonly instructions: string;
  };
  readonly shippedChanged?: boolean;
};

/** A person's replacement content. A skill's name is its id and is not edited. */
export type ComponentContentDraft = {
  readonly name?: string;
  readonly description: string;
  readonly instructions: string;
};

/** One installed package as a person sees it, joined to live runtime state. */
export type PluginState = {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly category: string;
  readonly publisher: string;
  readonly source: "built-in" | "personal" | "project" | "marketplace";
  /** Package activation; component preferences remain stored while this is off. */
  readonly enabled: boolean;
  /**
   * `authored` for a plugin made in the app, which is edited and removed as a
   * whole; `override` for a shipped or imported one, whose components take
   * edits layered over their content.
   */
  readonly editing: "authored" | "override";
  /** Whether an update replaced a version this package can still restore. */
  readonly rollbackAvailable: boolean;
  readonly status: "ready" | "partial" | "off" | "failed";
  readonly defaultPrompts: readonly string[];
  readonly accessSummary?: string;
  readonly dataDestination?: string;
  readonly components: readonly PluginComponentState[];
};

/**
 * A skill's SKILL.md has no field for a display name distinct from its
 * portable slug — `id` doubles as both.
 */
export type AuthoredSkillDraft = {
  readonly id: string;
  readonly description: string;
  readonly instructions: string;
};

export type AuthoredSpecialistDraft = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly access?: "read" | "change";
  readonly tools?: readonly string[];
};

export type AuthoredMcpServerDraft = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly url: string;
  readonly access?: string;
  readonly dataDestination?: string;
};

/** A plugin's editable content, round-tripped whole on every save. */
export type AuthoredPluginContents = {
  readonly displayName: string;
  readonly description: string;
  readonly skills: readonly AuthoredSkillDraft[];
  readonly specialists: readonly AuthoredSpecialistDraft[];
  readonly mcpServers: readonly AuthoredMcpServerDraft[];
};
