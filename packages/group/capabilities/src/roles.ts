/**
 * The group's public interface, split by who uses it. Each part of the app
 * that reaches the capabilities takes only the role it uses, so a part that
 * shows plugins cannot run a tool, and a turn cannot install a plugin.
 */

import type {
  ActionDetail,
  AuthoredPluginContents,
  CatalogEntry,
  CatalogEntryKind,
  CommandFileChanges,
  CommandOutput,
  ComponentContent,
  ComponentContentDraft,
  ConnectionToolTreatment,
  McpConnectionTestOutcome,
  McpServerDefinition,
  McpServerState,
  McpSignInOutcome,
  PluginDirectoryEntry,
  PluginState,
  RunningCommand,
  ShellAvailability,
  SpecialistDefinition,
  ToolCallInspection,
  ToolInvocationResult,
  ToolOwner,
  ToolSpec,
  UserInputResponse,
} from "@zhiyin/contract";
import type { PluginContents } from "./plugin-directory.js";

/** A skill as the model is told about it. */
export type Skill = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
};

/** What one conversation's turn may call. */
export type ConversationTools = {
  /**
   * Every tool the model is offered, in the order it is offered: the workspace
   * tools and each activated plugin's core tools.
   */
  readonly tools: readonly ToolSpec[];
  /** The skills of every enabled plugin, which the model is told about by name. */
  readonly skills: readonly Skill[];
  /** The specialists of every enabled plugin, which a turn may delegate to. */
  readonly specialists: readonly SpecialistDefinition[];
  /**
   * Every enabled plugin's compact identity, the same whether or not the
   * conversation has activated it.
   */
  readonly pluginDirectory: readonly PluginDirectoryEntry[];
  /**
   * The toolkits of enabled plugins (ADR 0017): tools that load when opened,
   * never in `tools` until then.
   */
  readonly toolkits: readonly OfferedToolkit[];
  /**
   * Who answers for a name, a toolkit's tool not yet opened included; nothing
   * for a name nobody offered.
   */
  readonly ownerOf: (name: string) => ToolOwner | undefined;
};

/** A toolkit a conversation may open, and the tools it loads. */
export type OfferedToolkit = {
  /** Its catalog id, as `toolkit:3d-rendering/surfacing`. */
  readonly id: string;
  readonly plugin: string;
  readonly tools: readonly ToolSpec[];
};

/**
 * An entry read whole. A skill or a toolkit is Zhiyin's guidance, answered
 * outside the untrusted fence; a page, a function or an API change is
 * reference, weighed as data (ADR 0016).
 */
export type CatalogOpening =
  | {
      readonly ok: true;
      readonly entry: CatalogEntry;
      readonly text: string;
      readonly voice: "guidance" | "reference";
      /** The plugin opening it activates. */
      readonly plugin: string;
      /** A toolkit's tools, which opening it loads. */
      readonly tools?: readonly ToolSpec[];
    }
  | { readonly ok: false; readonly reason: string };

export type ToolGathering =
  | { readonly ok: true; readonly value: ConversationTools }
  | { readonly ok: false; readonly reason: string };

/** What running a tool may be given beside the call itself. */
export type ExecuteOptions = {
  readonly signal?: AbortSignal | undefined;
  /** A connector tool as it was when the call was approved. */
  readonly identity?: string | undefined;
  /**
   * The most of its answer the model is shown, so a tool that reads in pages
   * returns a page that fits.
   */
  readonly answerTokens?: number | undefined;
};

/** What a conversation's turns use: its tools, their inspection and running. */
export interface CapabilityTools {
  /**
   * Gathers the tools a conversation may call. A source that cannot answer
   * offers nothing rather than failing the turn; two sources claiming one
   * name fail it, because a call could then reach the wrong implementation.
   */
  toolsFor(
    conversationId: string,
    options: {
      readonly skills: boolean;
      /** Plugin ids activated in this conversation so far. */
      readonly activatedPlugins?: readonly string[];
      /** Hears each connection the gathering waits for, before it waits. */
      readonly onConnecting?: (connectionName: string) => void;
    },
  ): Promise<ToolGathering>;
  /**
   * The catalog entries of the enabled plugins that best match a query, five
   * at most, best first; of one kind when a kind is given.
   */
  catalogFind(
    conversationId: string,
    query: string,
    kind?: CatalogEntryKind,
  ): Promise<readonly CatalogEntry[]>;
  /** One entry whole; a switched-off plugin's or an unknown id is refused. */
  catalogOpen(conversationId: string, id: string): Promise<CatalogOpening>;
  /** One enabled plugin's components by name and purpose, or nothing for an unknown or disabled id. */
  pluginContents(id: string): Promise<PluginContents | undefined>;
  /** The same components arranged for a readable action result. */
  describePluginContents(contents: PluginContents): readonly ActionDetail[];
  inspect(
    conversationId: string,
    owner: ToolOwner,
    name: string,
    args: unknown,
  ): Promise<ToolCallInspection>;
  execute(
    conversationId: string,
    owner: ToolOwner,
    name: string,
    args: unknown,
    options?: ExecuteOptions,
  ): Promise<ToolInvocationResult>;
  /** Present only when the built-in tools can accept a person's answer. */
  readonly completeUserInput:
    | ((
        name: string,
        args: unknown,
        response: UserInputResponse,
      ) => Promise<ToolInvocationResult>)
    | undefined;
  /**
   * Ends what a stopped turn left running in this conversation: its commands
   * and jobs. Its browser, 3D scene and connections stay open with what they
   * show, so the next turn carries on from them.
   */
  stopConversation(conversationId: string): Promise<void>;
}

/**
 * The plugins and connections as they stand, for the window, and the
 * onboarding question that switches the built-in plugins.
 */
export interface CapabilityOverview {
  /** Installed packages joined to the current state of what they contain. */
  pluginStates(
    connections?: readonly McpServerState[],
  ): Promise<readonly PluginState[]>;
  /** What each connection last answered; reaches none of them. */
  connections(): Promise<readonly McpServerState[]>;
  /** What a person may say they are here to do: the built-in plugins. */
  interests(): Promise<readonly string[]>;
  /** Switches the built-in plugins on or off to match a person's interests. */
  applyInterests(interests: readonly string[]): Promise<void>;
}

/** What a person changes in their plugins and the components they contain. */
export interface PluginManagement {
  /** A skill's or specialist's full content, or nothing for an unknown id. */
  componentContent(id: string): Promise<ComponentContent | undefined>;
  /** An app-made plugin's whole content, or nothing for any other plugin. */
  editablePluginContents(
    id: string,
  ): Promise<AuthoredPluginContents | undefined>;
  setPluginEnabled(id: string, enabled: boolean): Promise<void>;
  setComponentEnabled(id: string, enabled: boolean): Promise<void>;
  overrideComponent(id: string, content: ComponentContentDraft): Promise<void>;
  resetComponent(id: string): Promise<void>;
  /** Validates and stores a copy from a local directory. Refused for a built-in name. */
  installPlugin(sourceDirectory: string): Promise<void>;
  /** Replaces the active version with a newer one, keeping the previous for rollback. */
  updatePlugin(id: string, sourceDirectory: string): Promise<void>;
  /** Restores the version an update replaced. */
  rollbackPlugin(id: string): Promise<void>;
  removePlugin(id: string): Promise<void>;
  /** Creates an empty plugin, ready for skills, specialists, and connectors. */
  createPlugin(displayName: string, description: string): Promise<void>;
  /** Replaces an app-made plugin's skills, specialists, and connectors. */
  savePluginContents(
    id: string,
    contents: AuthoredPluginContents,
  ): Promise<void>;
  /**
   * Installs what an application connector needs: its programs, then what it
   * makes with them; the signal stops it.
   */
  installToolchain(componentId: string, signal?: AbortSignal): Promise<void>;
}

/** What a person changes in their connections: tokens, sign-ins and tool choices. */
export interface ConnectionManagement {
  /** Reaches one configured connection now, as a person asked. */
  checkConnection(id: string): Promise<McpServerState>;
  /** Tries failed connections again on the next look. */
  retryConnections(): Promise<void>;
  setConnectionToolEnabled(
    id: string,
    toolName: string,
    enabled: boolean,
  ): Promise<void>;
  /** How a tool of a connection Zhiyin does not ship is treated. */
  setConnectionToolTreatment(
    id: string,
    toolName: string,
    treatment: ConnectionToolTreatment,
    /** The version of the tool the person was shown, as its summary gave it. */
    shown: string,
  ): Promise<void>;
  /** A dry run against an endpoint and (optional) token, saving nothing. */
  testConnection(
    server: McpServerDefinition,
    token?: string,
  ): Promise<McpConnectionTestOutcome>;
  saveConnectionToken(id: string, token: string): Promise<void>;
  clearConnectionToken(id: string): Promise<void>;
  signInToConnection(
    id: string,
    signal: AbortSignal,
  ): Promise<McpSignInOutcome>;
}

/**
 * Commands carried on as jobs (ADR 0012), and the shell they run in: what the
 * person sees and stops, and what a job tells its conversation.
 */
export interface CommandWatch {
  /** Whether the shell tool can run here, and why not when it can't. */
  shellAvailability(): ShellAvailability;
  /** Re-detects the shell without restarting, so a fixed prerequisite is picked up. */
  recheckShell(): ShellAvailability;
  /** A conversation's commands running as jobs, for the person to see. */
  runningCommands(conversationId: string): readonly RunningCommand[];
  /** What a running job has printed so far; nothing once it has ended. */
  commandOutput(
    conversationId: string,
    jobId: string,
  ): Promise<CommandOutput | undefined>;
  /** Stops a job because the person asked; the conversation is told. */
  stopCommandForPerson(conversationId: string, jobId: string): Promise<void>;
  /** Told when a conversation's running jobs change. */
  onCommandsChanged(watcher: (conversationId: string) => void): void;
  /** Told what changed in the folder while a job ran, once it has ended. */
  onJobChanges(
    watcher: (
      conversationId: string,
      job: string,
      changes: CommandFileChanges,
    ) => void,
  ): void;
  /**
   * Told when a conversation's command, carried on as a job, ends by itself,
   * with a sentence saying how, or when the person stops it, which `wakes`
   * nothing. One the model stops is not announced.
   */
  onCommandEnded(
    listener: (conversationId: string, notice: string, wakes: boolean) => void,
  ): void;
}

/**
 * What the group is told as conversations and the app come and go, so what a
 * conversation holds is let go of in one place.
 */
export interface CapabilityLifecycle {
  /**
   * Closes the browser and Blender of a conversation left alone, which hold
   * the most memory. The conversation keeps everything else, and both open
   * again on their next use.
   */
  restConversation(conversationId: string): Promise<void>;
  /**
   * Lets go of everything a conversation held, for one that is gone. Nothing is
   * kept for it, because nothing will ask for it again.
   */
  forgetConversation(conversationId: string): Promise<void>;
  /**
   * The chosen model, or what it accepts, changed: the tools of the
   * connections Zhiyin ships are listed again, since what one offers can
   * follow the model, as the browser's screenshot does.
   */
  modelChanged(): Promise<void>;
  shutdown(): Promise<void>;
}
