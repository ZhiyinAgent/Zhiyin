/**
 * One plugin's compact identity, advertised in place of its full instructions
 * and tool schemas until it is activated: every enabled plugin, and each
 * built-in one the person switched off.
 */
export type PluginDirectoryEntry = {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
  readonly includes: {
    readonly skills: readonly string[];
    readonly specialists: readonly string[];
    readonly connectors: readonly string[];
  };
  readonly activated: boolean;
  /**
   * A built-in plugin the person switched off, such as by what they chose
   * when they started: listed so the model can tell them it exists, never
   * inspected or activated until they switch it on in Plugins.
   */
  readonly switchedOff?: true;
};

/** What a model asking for a plugin the person switched off is told. */
export const PLUGIN_SWITCHED_OFF =
  "That plugin is switched off. The person can switch it on in Plugins.";
