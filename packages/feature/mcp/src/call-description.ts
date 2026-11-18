import type { ToolInvocation } from "@zhiyin/contract";

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

/**
 * One row per input, with what the server says it is for.
 *
 * Every input the model actually sent appears, whether the schema mentions it
 * or not, and each appears whole, however long: what is going to the server
 * is the thing being agreed to, and an input hidden because it was unexpected,
 * or a part of one cut for length, is the part most worth seeing.
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
        value: text,
        ...(description ? { described: description } : {}),
      };
    }),
  };
}

/**
 * Where a call's data goes: the connection's address. A built-in connection
 * has none, so a call of one names none. The place a call acts on is its
 * effects' to say, not this.
 */
export function sentTo(address: string): {
  readonly destinations?: readonly string[];
} {
  return address ? { destinations: [address] } : {};
}
