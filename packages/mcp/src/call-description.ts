import type { ToolInvocation } from "@zhiyin/contract";

const maximumArgumentCharacters = 2000;

/**
 * The parameter descriptions a tool declares, by parameter name. Absent
 * wherever the server said nothing: an input nobody described is shown
 * undescribed rather than given words this app made up for it.
 */
function schemaDescriptions(
  schema: Readonly<Record<string, unknown>> | undefined,
): ReadonlyMap<string, string> {
  const properties =
    schema && typeof schema.properties === "object" && schema.properties
      ? (schema.properties as Record<string, unknown>)
      : {};
  const described = new Map<string, string>();
  for (const [name, property] of Object.entries(properties)) {
    if (!property || typeof property !== "object") continue;
    const description = (property as { description?: unknown }).description;
    if (typeof description === "string" && description.trim())
      described.set(name, description.trim());
  }
  return described;
}

/** Keeps both ends of an over-long value, and says how much of the middle went. */
function boundArgument(text: string): {
  readonly value: string;
  readonly omitted?: number;
} {
  if (text.length <= maximumArgumentCharacters) return { value: text };
  const half = Math.floor(maximumArgumentCharacters / 2);
  return {
    value: `${text.slice(0, half)}${text.slice(text.length - half)}`,
    omitted: text.length - half * 2,
  };
}

/**
 * One row per input, with what the server says it is for.
 *
 * Every input the model actually sent appears, whether the schema mentions it
 * or not: what is going to the server is the thing being agreed to, and an
 * input hidden because it was unexpected is the one most worth seeing.
 */
export function describeCall(
  toolName: string,
  args: Record<string, unknown>,
  via: string,
  schema: Readonly<Record<string, unknown>> | undefined,
): ToolInvocation {
  const described = schemaDescriptions(schema);
  return {
    name: toolName,
    via,
    arguments: Object.entries(args).map(([name, value]) => {
      const text =
        typeof value === "string"
          ? value
          : (JSON.stringify(value, null, 2) ?? "");
      const description = described.get(name);
      return {
        name,
        ...boundArgument(text),
        ...(description ? { described: description } : {}),
      };
    }),
  };
}
