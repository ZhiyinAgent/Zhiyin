import type { ActionEffects } from "@zhiyin/contract";
import type { DeclaredMcpServer } from "./mcp-servers.js";

/**
 * What a set of a declared connection's tools does (ADR 0012), by the names
 * the server gives them. `destination` names where an action lands from the
 * call's own arguments: each `{name}` stands for the argument of that name,
 * and any other text is kept as it is. `notReadOnly` says why tools that
 * change nothing and act as no one are still not offered as only reading.
 */
export type DeclaredToolEffects = {
  readonly tools: readonly string[];
  readonly effects: Omit<ActionEffects, "destination">;
  readonly destination?: string;
  readonly notReadOnly?: string;
};

/** What the current declarations say each connection's tools do. */
export class DeclaredEffects {
  #byConnection: ReadonlyMap<string, ReadonlyMap<string, DeclaredToolEffects>> =
    new Map();

  /** Keeps what these declarations say, and forgets what earlier ones said. */
  learn(declared: readonly DeclaredMcpServer[]): void {
    this.#byConnection = new Map(
      declared.map((server) => [
        server.id,
        new Map(
          (server.toolEffects ?? []).flatMap((group) =>
            group.tools.map((tool) => [tool, group] as const),
          ),
        ),
      ]),
    );
  }

  /** What one call does, when its connection's declaration names its tool. */
  ofCall(
    connection: string,
    tool: string,
    args: Readonly<Record<string, unknown>>,
  ): ActionEffects | undefined {
    const declared = this.#byConnection.get(connection)?.get(tool);
    return declared && effectsOfCall(declared, args);
  }

  /**
   * Whether the declaration says a tool only reads: it changes nothing, acts
   * as no one, runs nothing and leaves nothing behind, and the declaration
   * gives no reason to offer it as more.
   */
  readsOnly(connection: string, tool: string): boolean {
    const declared = this.#byConnection.get(connection)?.get(tool);
    if (!declared || declared.notReadOnly !== undefined) return false;
    const { effects } = declared;
    return (
      effects.changes === "none" &&
      effects.actsAsPerson === "none" &&
      effects.runs === "none" &&
      !effects.lasting
    );
  }
}

/** What one call does, by its tool's declaration and the call's arguments. */
function effectsOfCall(
  declared: DeclaredToolEffects,
  args: Readonly<Record<string, unknown>>,
): ActionEffects {
  const destination =
    declared.destination === undefined
      ? undefined
      : filledIn(declared.destination, args);
  // A call that does not name where it lands is said as it is, with no
  // place: the policy asks about it every time.
  return destination === undefined
    ? { ...declared.effects }
    : { ...declared.effects, destination };
}

/**
 * The template with each `{name}` replaced by the call's argument of that
 * name: text, or a list holding one text. Absent when any is missing or blank,
 * or when a list holds several, since one destination cannot name them all.
 */
function filledIn(
  template: string,
  args: Readonly<Record<string, unknown>>,
): string | undefined {
  let whole = true;
  const filled = template.replace(/\{([^{}]+)\}/g, (_, name: string) => {
    const value = args[name];
    const one = Array.isArray(value) && value.length === 1 ? value[0] : value;
    if (typeof one === "string" && one.trim()) return one;
    whole = false;
    return "";
  });
  return whole ? filled : undefined;
}
