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
    readonly connectors: readonly string[];
    /** Its toolkits, by catalog id. */
    readonly toolkits: readonly string[];
  };
  /**
   * A built-in plugin the person switched off, such as by what they chose
   * when they started: listed so the model can tell them it exists, never
   * opened or activated until they switch it on in Plugins.
   */
  readonly switchedOff?: true;
};

/** What a model asking for a plugin the person switched off is told. */
export const PLUGIN_SWITCHED_OFF =
  "That plugin is switched off. The person can switch it on in Plugins.";
