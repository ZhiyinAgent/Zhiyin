/**
 * Where a connection may travel unencrypted: nowhere but this computer. Any
 * other address must use https, since what is sent to it, an access token
 * among it, would otherwise cross the network readable by anyone on the way.
 */
const thisComputer = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Takes an address as a parsed `URL` gives it: host in lower case, IPv6 in brackets. */
export function travelsSecurely(address: {
  readonly protocol: string;
  readonly hostname: string;
}): boolean {
  if (address.protocol === "https:") return true;
  return address.protocol === "http:" && thisComputer.has(address.hostname);
}

/** An address as a parsed `URL` gives it, in the parts the rule reads. */
export type ParsedAddress = {
  readonly protocol: string;
  readonly hostname: string;
  readonly username: string;
  readonly password: string;
  readonly searchParams: { keys(): Iterable<string> };
};

/**
 * What keeps a connector's address from being dialled, or nothing: one that
 * did not parse as an address (none given), one that is not http or https,
 * plain http anywhere but this computer, or one that carries its own
 * credential, in its user name, its password or a token-like query
 * parameter, since an address is displayed and kept as the connection's
 * identity. Each place that checks an address says the problem in its own
 * reader's words.
 */
export function addressProblem(
  parsed: ParsedAddress | undefined,
): "unreadable" | "not-http" | "unencrypted" | "credentials" | undefined {
  if (!parsed) return "unreadable";
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    return "not-http";
  if (!travelsSecurely(parsed)) return "unencrypted";
  if (
    parsed.username ||
    parsed.password ||
    [...parsed.searchParams.keys()].some((key) =>
      /token|secret|password|api.?key/i.test(key),
    )
  )
    return "credentials";
  return undefined;
}
