/**
 * What a script's approval shows of it, and whether it can be shown as what
 * runs at all.
 */

import type { ToolArgument } from "@zhiyin/contract";

/**
 * Why a script cannot be shown as what runs, if it cannot. Zhiyin writes a
 * script as UTF-8, but Python reads it in whatever encoding its first or
 * second line declares (PEP 263), and in another one, such as UTF-7, text the
 * approval shows as a comment can be code.
 */
export function declaredEncodingRefusal(source: string): string | undefined {
  for (const line of source.split(/\r\n|\r|\n/).slice(0, 2)) {
    const declared = /^[ \t\f]*#.*?coding[:=][ \t]*([-\w.]+)/.exec(line)?.[1];
    if (declared !== undefined && !/^utf[-_]?8$/i.test(declared))
      return `This script declares the ${declared} encoding, so Python would read it differently from what is shown. Remove that line, or declare utf-8.`;
    // Python reads the second line for it only after a blank or comment line.
    if (!/^[ \t\f]*(#.*)?$/.test(line)) break;
  }
  return undefined;
}

/**
 * A script as its approval shows it: the code whole, as what runs, the file
 * it comes from, then its arguments as a command line has them, the environment when it is not
 * the default one, and the hosts it may reach.
 */
export function scriptRows(
  code: { code: string; file?: string },
  given: unknown,
  environment: string | undefined,
  hosts: readonly string[] = [],
): ToolArgument[] {
  const parts = Array.isArray(given) ? given : [];
  // A part with a space, a quote or nothing in it is quoted, so each reads apart.
  const line = parts
    .map((part) =>
      typeof part === "string" && /^[^\s"]+$/.test(part)
        ? part
        : JSON.stringify(part),
    )
    .join(" ");
  return [
    { name: "Code", value: code.code, runs: true },
    ...(code.file
      ? [{ name: "Script", value: code.file, readable: true as const }]
      : []),
    ...(line
      ? [{ name: "Arguments", value: line, readable: true as const }]
      : []),
    ...(environment
      ? [{ name: "Environment", value: environment, readable: true as const }]
      : []),
    ...(hosts.length
      ? [{ name: "Hosts", value: hosts.join(", "), readable: true as const }]
      : []),
  ];
}
