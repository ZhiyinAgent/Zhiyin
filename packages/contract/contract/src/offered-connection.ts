/**
 * A connection a feature offers from inside the app: the browser, the 3D
 * studio, git, Python and the document compiler each offer one, and the
 * connections feature runs it like any other. Declared here because a feature
 * may not import the feature that runs it.
 */

import type {
  ActionDetail,
  ProducedFile,
  ToolCallInspection,
  ToolInvocationResult,
} from "./tool-invocation.js";

declare global {
  /**
   * Node and the window both provide `AbortSignal`. The contract assumes
   * neither runtime, so it names the part it relies on and each runtime gives
   * the rest.
   */
  interface AbortSignal {
    readonly aborted: boolean;
  }
}

/** A tool as a connection lists it. */
export type ConnectionTool = {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
  /**
   * What the person reads for the tool while a call to it is written, said by
   * the code of a connection Zhiyin ships, as its approval names the action.
   * Taken from no other server.
   */
  readonly label?: string;
  /**
   * The tool only reads, said by the code of a connection Zhiyin ships. Taken
   * from no other server, whatever it says of its own tools.
   */
  readonly access?: "read";
  /**
   * Its answer says how what it works on stands now, as `ToolSpec` says, by
   * the code of a connection Zhiyin ships. Taken from no other server.
   */
  readonly reportsState?: true;
  /**
   * How a call to it checks work, as `ToolSpec` says, by the code of a
   * connection Zhiyin ships. Taken from no other server.
   */
  readonly checksWork?: "runs" | "shows";
  /**
   * The toolkit, within its plugin, the tool loads with (ADR 0017), said by
   * the code of a connection Zhiyin ships; a tool with none is a core tool,
   * there whenever its plugin is active. Taken from no other server.
   */
  readonly toolkit?: string;
};

type Arguments = Readonly<Record<string, unknown>>;

export type OfferedConnection = {
  listTools(): Promise<readonly ConnectionTool[]>;
  /** What a call will do, before anyone is asked to approve it. */
  inspect(name: string, args: Arguments): Promise<ToolCallInspection>;
  /**
   * Runs a call. `binding` is the approved inspection's identity, for a
   * connection that checks nothing changed in between.
   */
  callTool(
    name: string,
    args: Arguments,
    signal?: AbortSignal,
    binding?: string,
  ): Promise<unknown>;
  /** How a finished call went, for the person to read. */
  describeResult(
    name: string,
    args: Arguments,
    result: ToolInvocationResult,
  ): readonly ActionDetail[];
  /** The workspace files a successful call wrote, for a connection that writes any. */
  produced?(
    name: string,
    args: Arguments,
    value: unknown,
  ): readonly ProducedFile[];
  close(): Promise<void>;
};

/** An offered connection whose calls write files it names. */
export type WritingConnection = OfferedConnection &
  Required<Pick<OfferedConnection, "produced">>;
