/**
 * Who answers for a tool call. The permission engine decides on it, and a
 * remote tool cannot gain a built-in tool's authority by taking its name.
 */
export type ToolOwner = "built-in" | "mcp" | "skill" | "plugin";

/** A tool as named to the agent and shown to the user. */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  /** Trusted only for app-owned tools when limiting read-only specialists. */
  readonly access?: "read" | "change";
}

/**
 * Whether the `bash` tool can run here. Absent a shell, it is a capability
 * that does not exist and is never advertised to the model — this is what a
 * person is told instead, so the gap is not silent.
 */
export type ShellAvailability =
  | { readonly available: true }
  | {
      readonly available: false;
      readonly reason: string;
      readonly installUrl: string;
    };

/**
 * Every external URL `openExternalUrl` may open. Fixed at build time, not
 * supplied at the call site's discretion — an allowlist, not a proxy for any
 * URL a renderer happens to have on hand.
 */
export const ALLOWED_EXTERNAL_URLS = [
  "https://git-scm.com/download/win",
] as const;
