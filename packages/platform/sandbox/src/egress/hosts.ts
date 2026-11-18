/**
 * The hosts a confined run may reach, as its caller names them: a name, such
 * as `pypi.org`, or `*.` and a name for every name below it, each with a port,
 * 443 when none is given. Names are compared in their ASCII form, without
 * case or a final dot.
 */

import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import { unreachableAddress } from "./dial.js";

export type HostEntry = {
  /** The name, or the address, in its plain form. */
  readonly name: string;
  /** Whether names below `name` are meant, rather than `name` itself. */
  readonly below: boolean;
  readonly port: number;
};

const label = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const httpsPort = 443;

/** A name or address in the form hosts are compared in, or nothing. */
export function plainHost(host: string): string | undefined {
  const bare =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (isIP(bare)) return bare.toLowerCase();
  const ascii = domainToASCII(bare.replace(/\.$/, "")).toLowerCase();
  if (!ascii || ascii.length > 253) return undefined;
  return ascii.split(".").every((part) => label.test(part)) ? ascii : undefined;
}

/** A name that means this computer, whatever it resolves to. */
function namesThisComputer(name: string): boolean {
  return name === "localhost" || name.endsWith(".localhost");
}

/** One entry as written, or why it cannot be one. */
function entryOf(written: unknown): HostEntry | string {
  if (typeof written !== "string" || !written.trim())
    return "Name each host as text, such as pypi.org.";
  const text = written.trim();
  if (/[/?#@\s]/.test(text) || text.includes("://"))
    return `“${text}” is not a host: name it alone, such as pypi.org, without a scheme or path.`;
  // An IPv6 address carries colons of its own: it takes a port only in brackets.
  const parts =
    isIP(text) === 6
      ? [text, text]
      : (/^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(text) ??
        /^([^:[\]]+)(?::(\d{1,5}))?$/.exec(text));
  if (!parts) return `“${text}” is not a host name or address.`;
  const host = parts[1] as string;
  const port = isIP(text) === 6 || !parts[2] ? httpsPort : Number(parts[2]);
  if (port < 1 || port > 65535)
    return `“${text}” names a port that does not exist.`;
  const below = host.startsWith("*.");
  const name = plainHost(below ? host.slice(2) : host);
  if (!name) return `“${text}” is not a host name or address.`;
  if (below && (isIP(name) || !name.includes(".")))
    return `“${text}” is too wide: “*.” goes before a domain, such as *.example.com.`;
  if (namesThisComputer(name))
    return `“${text}” is this computer, which no run reaches.`;
  const address = unreachableAddress(name);
  if (address) return address;
  return { name, below, port };
}

/** The entries hosts name, or why one of them cannot be given. */
export function hostEntries(
  hosts: readonly unknown[],
): readonly HostEntry[] | string {
  const entries: HostEntry[] = [];
  for (const written of hosts) {
    const entry = entryOf(written);
    if (typeof entry === "string") return entry;
    if (
      !entries.some(
        (kept) =>
          kept.name === entry.name &&
          kept.below === entry.below &&
          kept.port === entry.port,
      )
    )
      entries.push(entry);
  }
  return entries;
}

/** Why a list of hosts cannot be given, or nothing when it can. */
export function hostListProblem(hosts: readonly unknown[]): string | undefined {
  const entries = hostEntries(hosts);
  return typeof entries === "string" ? entries : undefined;
}

/** The hosts as a run is given them, each once and in order, to show or compare. */
export function hostList(hosts: readonly string[]): readonly string[] {
  const entries = hostEntries(hosts);
  if (typeof entries === "string") return [];
  return entries.map(written).sort();
}

function written(entry: HostEntry): string {
  const host = isIP(entry.name) === 6 ? `[${entry.name}]` : entry.name;
  return `${entry.below ? "*." : ""}${host}${entry.port === httpsPort ? "" : `:${entry.port}`}`;
}

/** Whether an entry lets a run reach `host` (already plain) on `port`. */
export function allows(
  entries: readonly HostEntry[],
  host: string,
  port: number,
): boolean {
  return entries.some(
    (entry) =>
      entry.port === port &&
      (entry.below ? host.endsWith(`.${entry.name}`) : host === entry.name),
  );
}
