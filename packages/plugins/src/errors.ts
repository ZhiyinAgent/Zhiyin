export class PluginStoreError extends Error {
  readonly code:
    "collision" | "invalid" | "notFound" | "unsupported" | "unavailable";

  constructor(code: PluginStoreError["code"], message: string) {
    super(message);
    this.name = "PluginStoreError";
    this.code = code;
  }
}
