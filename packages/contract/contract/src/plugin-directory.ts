import type { ConnectorSetup } from "./plugin-state.js";

/**
 * What a connector needs before it can be used, as the plugin directory marks
 * it: a key, a sign-in, a program installed (one whose install failed, or a
 * missing prerequisite such as a browser, included), a check after it could
 * not start, or switching on, the person having switched it off. Each is done
 * under Connectors on its plugin's page in Plugins.
 */
export type ConnectorNeed =
  "key" | "sign-in" | "install" | "could-not-start" | "switched-off";

/**
 * One plugin's compact identity, as the plugin directory lists it to the
 * model: every enabled plugin, and each built-in one the person switched off.
 * It is the same whether or not a conversation has activated the plugin, so
 * activating one leaves the start of the request as it was (ADR 0017).
 */
export type PluginDirectoryEntry = {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
  readonly includes: {
    /** Each skill by its catalog id and what it is for. */
    readonly skills: readonly {
      readonly id: string;
      readonly description: string;
    }[];
    readonly specialists: readonly string[];
    /** Every connector, those switched off included. */
    readonly connectors: readonly string[];
    /** Its toolkits, by catalog id. */
    readonly toolkits: readonly string[];
  };
  /**
   * Each connector that cannot be used as things stand, by its id, with what
   * it needs. A connector that is ready or not reached yet is not named.
   */
  readonly needs?: Readonly<Record<string, ConnectorNeed>>;
  /**
   * A built-in plugin the person switched off, such as by what they chose
   * when they started: listed so the model can tell them it exists, never
   * opened or activated until they switch it on in Plugins.
   */
  readonly switchedOff?: true;
};

/** The marks of one directory entry that follow what the person sets up. */
export type PluginReadiness = Pick<
  PluginDirectoryEntry,
  "needs" | "switchedOff"
>;

/** The directory's marks, by plugin id. */
export type DirectoryReadiness = Readonly<Record<string, PluginReadiness>>;

/**
 * What a card in the conversation asks the person to set up, all of it in
 * Zhiyin's own words from its declarations, never the model's: the plugin
 * whose page its button opens at Connectors, and the connector.
 */
export type SetupSuggestion = {
  readonly plugin: {
    readonly id: string;
    readonly name: string;
    /** The person switched the plugin off: switching it on comes first. */
    readonly switchedOff?: true;
  };
  /** Absent when the card is for a plugin switched off as a whole. */
  readonly connector?: {
    readonly id: string;
    readonly name: string;
    readonly needs?: ConnectorNeed;
    /** How the key is made, as the connector's package states it. */
    readonly setup?: ConnectorSetup;
    /** Why it could not start or what it is missing, as Zhiyin found it. */
    readonly detail?: string;
  };
};

/** What a model asking for a plugin the person switched off is told. */
export const PLUGIN_SWITCHED_OFF =
  "That plugin is switched off. The person can switch it on in Plugins.";
