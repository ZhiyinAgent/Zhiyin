/**
 * What the sandbox's tools read from a call and say back, the same whether a
 * call is being approved or run.
 */

import { hostList, hostListProblem } from "@zhiyin/sandbox";
import { defaultEnvironment } from "./environments.js";

export const notInstalled =
  "The Python environment is not installed. Install it from the Data Science plugin before running scripts.";

const hostsAnswer =
  'Name the hosts the script may reach as a list of text, such as ["api.github.com"], or leave hosts out.';

export const nameEnvironment = "Name the environment with text.";

/**
 * The hosts a call lets the script reach, each once, in order: none unless it
 * names some. Or why they cannot be given.
 */
export function askedHosts(
  args: Record<string, unknown>,
):
  | { readonly ok: true; readonly hosts: readonly string[] }
  | { readonly ok: false; readonly reason: string } {
  if ("network" in args)
    return {
      ok: false,
      reason:
        'Name the hosts the script may reach in hosts, such as ["pypi.org"]; network is not taken.',
    };
  const hosts = args["hosts"];
  if (hosts === undefined) return { ok: true, hosts: [] };
  if (!Array.isArray(hosts)) return { ok: false, reason: hostsAnswer };
  const problem = hostListProblem(hosts);
  if (problem) return { ok: false, reason: problem };
  return { ok: true, hosts: hostList(hosts as string[]) };
}

/** The environment a call names, the default when it names none, or nothing when it names one wrongly. */
export function chosenEnvironment(
  args: Record<string, unknown>,
  field = "environment",
): string | undefined {
  const named = args[field];
  if (named === undefined) return defaultEnvironment;
  return typeof named === "string" ? named : undefined;
}

export function missing(name: string): string {
  return `There is no Python environment named “${name}” ready to use. list_python_environments names those there are.`;
}

export function textResult(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text: text || "(no output)" }],
    ...(isError ? { isError: true } : {}),
  };
}

/** What a tool answers with. */
export type TextResult = ReturnType<typeof textResult>;

/** Hosts as a sentence names them: "a", "a and b", "a, b and c". */
export function listed(hosts: readonly string[]): string {
  return hosts.length < 2
    ? (hosts[0] ?? "")
    : `${hosts.slice(0, -1).join(", ")} and ${hosts.at(-1)}`;
}
