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
