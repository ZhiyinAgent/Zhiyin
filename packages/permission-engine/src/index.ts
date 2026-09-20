/**
 * Decides allow / ask / deny for every filesystem, shell and network action the
 * agent attempts. The single place "is this safe" is decided.
 *
 * Boundaries and invariants: docs/architecture/features/permission-engine/README.md
 */

import type { ToolOwner } from "@zhiyin/contract";

/** The exact, already-validated action the agent wants to perform. */
export type Action = {
  readonly kind: "tool";
  /**
   * The implementation that owns the action. A remote tool cannot gain a
   * built-in tool's authority by choosing the same name.
   */
  readonly owner: ToolOwner;
  readonly name: string;
  readonly arguments: unknown;
  readonly action: string;
  readonly target: string;
  readonly command: string;
  /**
   * What the implementation says the action does to durable state. Absent
   * means it made no claim, which is read as a change.
   */
  readonly access?: "read" | "change";
  /**
   * Whether the implementation confined the action to the selected workspace.
   * This engine never re-derives containment from `target`: the predicate that
   * matters is the one the tool enforces, and a second copy here would be a
   * second boundary to keep in sync.
   */
  readonly scope?: "workspace" | "outside";
};

/**
 * A decision carries a policy reason for audit and failure handling. The agent
 * loop owns task-specific display copy.
 */
export interface Decision {
  readonly outcome: "allow" | "ask" | "deny";
  readonly reason: string;
}

export interface PermissionEngine {
  decide(action: Action): Promise<Decision>;
}

/**
 * Production policy: only app-owned reads that the implementation has declared
 * contained by the selected workspace run without interruption. Every
 * open-world or durable effect remains possible, but requires an explicit
 * decision.
 *
 * The rule matches on the declaration, not on the tool's name. A name is
 * chosen by whoever writes the tool, so a name list grants authority to
 * anything willing to adopt the right word; a declaration is only trusted
 * because `owner` says the app wrote the code that made it. That is also why
 * an MCP tool's read-only annotation buys it nothing here: the server owns
 * that annotation, and it describes itself.
 *
 * Both facts must be present. Silence is not a claim, so an undeclared access
 * or scope resolves toward asking — a new built-in cannot become automatic by
 * forgetting to say what it does.
 */
export class GuardedPermissionEngine implements PermissionEngine {
  async decide(action: Action): Promise<Decision> {
    if (
      action.owner === "built-in" &&
      action.access === "read" &&
      action.scope === "workspace"
    ) {
      return {
        outcome: "allow",
        reason:
          "This is a read-only action contained by the selected workspace.",
      };
    }

    return {
      outcome: "ask",
      reason:
        action.owner === "mcp"
          ? "This action uses a connected tool and requires an explicit decision."
          : action.access === "read" && action.scope === "outside"
            ? "This reads outside the selected folder and requires an explicit decision."
            : "This action can change state or influence later work and requires an explicit decision.",
    };
  }
}

/** Conservative first policy: every valid tool call needs a person once. */
export class AskPermissionEngine implements PermissionEngine {
  async decide(): Promise<Decision> {
    return {
      outcome: "ask",
      reason: "The current policy requires an explicit decision.",
    };
  }
}
