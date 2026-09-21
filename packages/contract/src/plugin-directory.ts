/**
 * One enabled plugin's compact identity, advertised in place of its full
 * instructions and tool schemas until it is activated.
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
};
