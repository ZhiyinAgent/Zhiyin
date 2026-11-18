import type {
  AuthoredPluginContents,
  ComponentContent,
  ComponentContentDraft,
  ConnectionToolTreatment,
  McpConnectionTestOutcome,
  McpServerDefinition,
  McpServerState,
  McpSignInOutcome,
  PluginSourceOutcome,
  ShellAvailability,
} from "@zhiyin/contract";

/** What the Plugins page can do to a plugin, each by the plugin's id. */
export type PluginActions = {
  readonly toggle: (id: string, enabled: boolean) => Promise<void>;
  readonly install: () => Promise<PluginSourceOutcome>;
  readonly update: (id: string) => Promise<PluginSourceOutcome>;
  readonly rollback: (id: string) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
  readonly create: (displayName: string, description: string) => Promise<void>;
  /** The contents of a plugin made in the app, to edit. */
  readonly editableContents: (
    id: string,
  ) => Promise<AuthoredPluginContents | undefined>;
  readonly saveContents: (
    id: string,
    contents: AuthoredPluginContents,
  ) => Promise<void>;
};

/** What it can do to one of a plugin's components, by the component's full id. */
export type ComponentActions = {
  readonly toggle: (id: string, enabled: boolean) => Promise<void>;
  readonly content: (id: string) => Promise<ComponentContent | undefined>;
  readonly override: (
    id: string,
    content: ComponentContentDraft,
  ) => Promise<void>;
  readonly reset: (id: string) => Promise<void>;
  readonly installToolchain: (id: string) => Promise<void>;
  readonly cancelToolchainInstall: (id: string) => Promise<void>;
};

/** What it can do to a connector, by the connector's full id. */
export type ConnectionActions = {
  readonly test: (
    server: McpServerDefinition,
    token?: string,
  ) => Promise<McpConnectionTestOutcome>;
  readonly setToolEnabled: (
    id: string,
    toolName: string,
    enabled: boolean,
  ) => Promise<void>;
  /** Absent where the choice cannot be saved. */
  readonly setToolTreatment?:
    | ((
        id: string,
        toolName: string,
        treatment: ConnectionToolTreatment,
        shown: string,
      ) => Promise<void>)
    | undefined;
  readonly saveToken: (id: string, token: string) => Promise<void>;
  readonly clearToken: (id: string) => Promise<void>;
  readonly signIn: (id: string) => Promise<McpSignInOutcome>;
  readonly cancelSignIn: (id: string) => Promise<void>;
  /** Re-checks every connection now, trying failed ones again. */
  readonly refresh: () => Promise<void>;
  /** Reaches one configured connector now and says how it answered. */
  readonly check: (id: string) => Promise<McpServerState>;
};

/** Whether the shell that plugins' commands run in is there. */
export type ShellChecks = {
  /** The current reading, fetched once on open — never cached beyond that. */
  readonly check: () => Promise<ShellAvailability>;
  /** Re-detects the shell on request, so an install just now is picked up. */
  readonly recheck: () => Promise<ShellAvailability>;
};
