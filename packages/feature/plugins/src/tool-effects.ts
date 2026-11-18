import { InvalidPluginError, type PluginToolEffects } from "./plugins.js";

/**
 * Each part of what a tool does and the words it may be said in (ADR 0012).
 * Every part must be said: silence is not a claim that a tool does nothing.
 */
const vocabulary: Readonly<Record<string, readonly unknown[]>> = {
  reads: ["none", "workspace", "app", "elsewhere", "account"],
  changes: ["none", "app", "workspace", "workspace-for-good", "elsewhere"],
  sends: ["none", "service", "chosen"],
  actsAsPerson: ["none", "once", "for-good"],
  runs: ["none", "sealed", "full-access"],
  lasting: [true, false],
  brings: ["none", "outside"],
};

/** The parts said only where they apply. */
const optional: Readonly<Record<string, readonly unknown[]>> = {
  carries: ["address", "nothing"],
};

/** What a connector's `toolEffects` says its tools do, or why it is refused. */
export function toolEffectsOf(
  value: unknown,
  id: string,
): { toolEffects?: readonly PluginToolEffects[] } {
  if (value === undefined) return {};
  const refuse = (why: string) =>
    new InvalidPluginError(`MCP server “${id}” tool effects ${why}.`);
  if (!Array.isArray(value)) throw refuse("must be a list");
  const named = new Set<string>();
  const toolEffects = value.map((candidate): PluginToolEffects => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      throw refuse("must each be an object");
    const { tools, effects, destination, notReadOnly, ...rest } =
      candidate as Record<string, unknown>;
    if (Object.keys(rest).length)
      throw refuse(`name an unknown field “${Object.keys(rest)[0]}”`);
    if (
      !Array.isArray(tools) ||
      !tools.length ||
      !tools.every(
        (name) => typeof name === "string" && name && name.trim() === name,
      )
    )
      throw refuse("must each name one or more tools");
    for (const name of tools as string[]) {
      if (named.has(name)) throw refuse(`name “${name}” more than once`);
      named.add(name);
    }
    if (!effects || typeof effects !== "object" || Array.isArray(effects))
      throw refuse("must each say what the tools do");
    const said = effects as Record<string, unknown>;
    for (const key of Object.keys(said))
      if (!(key in vocabulary) && !(key in optional))
        throw refuse(`name an unknown part “${key}”`);
    for (const [key, words] of Object.entries(optional))
      if (key in said && !words.includes(said[key]))
        throw refuse(`must say “${key}” as one of ${words.join(", ")}`);
    for (const [key, words] of Object.entries(vocabulary))
      if (!words.includes(said[key]))
        throw refuse(`must say “${key}” as one of ${words.join(", ")}`);
    if (
      destination !== undefined &&
      (typeof destination !== "string" || !destination.trim())
    )
      throw refuse("must name a destination as text");
    if (
      notReadOnly !== undefined &&
      (typeof notReadOnly !== "string" || !notReadOnly.trim())
    )
      throw refuse("must say as text why tools are not read-only");
    return {
      tools: tools as string[],
      effects: said as PluginToolEffects["effects"],
      ...(destination === undefined ? {} : { destination }),
      ...(notReadOnly === undefined ? {} : { notReadOnly }),
    };
  });
  return { toolEffects };
}
