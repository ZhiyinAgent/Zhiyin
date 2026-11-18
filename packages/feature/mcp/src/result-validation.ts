export type SupportedMcpResult = {
  readonly content: readonly (
    | { readonly type: "text"; readonly text: string }
    | {
        readonly type: "image";
        readonly data: string;
        readonly mimeType: string;
      }
    | {
        readonly type: "resource";
        readonly resource: {
          readonly uri: string;
          readonly mimeType?: string;
          readonly text: string;
        };
      }
  )[];
  readonly structuredContent?: Readonly<Record<string, unknown>>;
  readonly isError?: boolean;
  readonly _meta?: Readonly<Record<string, unknown>>;
};

function isJsonValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : Object.values(value).every((item) => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}

/** The subset of CallToolResult this runtime can carry without guessing. */
export function supportedResult(value: unknown): value is SupportedMcpResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (
    Object.keys(result).some(
      (key) =>
        key !== "content" &&
        key !== "structuredContent" &&
        key !== "isError" &&
        key !== "_meta",
    )
  )
    return false;
  if (!Array.isArray(result["content"])) return false;
  if (
    "isError" in result &&
    result["isError"] !== undefined &&
    typeof result["isError"] !== "boolean"
  )
    return false;
  for (const field of ["structuredContent", "_meta"] as const) {
    const item = result[field];
    if (
      item !== undefined &&
      (!item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        !isJsonValue(item))
    )
      return false;
  }
  return result["content"].every((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const block = item as Record<string, unknown>;
    if (block["type"] === "text") return typeof block["text"] === "string";
    if (block["type"] === "image")
      return (
        typeof block["data"] === "string" &&
        typeof block["mimeType"] === "string" &&
        block["mimeType"].startsWith("image/")
      );
    if (block["type"] === "resource") {
      const resource = block["resource"];
      if (!resource || typeof resource !== "object" || Array.isArray(resource))
        return false;
      const contents = resource as Record<string, unknown>;
      return (
        typeof contents["uri"] === "string" &&
        typeof contents["text"] === "string" &&
        (contents["mimeType"] === undefined ||
          typeof contents["mimeType"] === "string") &&
        isJsonValue(block)
      );
    }
    return false;
  });
}
