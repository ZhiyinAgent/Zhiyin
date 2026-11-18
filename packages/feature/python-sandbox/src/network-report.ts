/**
 * What a script that names hosts reached, as its answer ends: each host it
 * asked for, with what it sent and received, or why it was refused or could
 * not be reached. The person's view of the action shows the same section.
 */

import type { ActionDetail, ToolInvocationResult } from "@zhiyin/contract";
import type { FurtherHosts, HostReach } from "@zhiyin/sandbox";

const heading = "\n\nNetwork:\n";

function amount(bytes: number): string {
  if (bytes < 1024) return bytes === 1 ? "1 byte" : `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function named(reach: HostReach): string {
  const host = reach.host.includes(":") ? `[${reach.host}]` : reach.host;
  return reach.port === 443 ? host : `${host}:${reach.port}`;
}

function count(value: number): string {
  return value.toLocaleString("en-US");
}

/** The line that counts what went to the hosts past the first hundred. */
function furtherLine(further: FurtherHosts): string {
  const requests = further.refused + further.failed + further.connections;
  const parts: string[] = [];
  if (further.refused) parts.push(`${count(further.refused)} refused`);
  if (further.failed)
    parts.push(`${count(further.failed)} could not be reached`);
  if (further.connections)
    parts.push(
      `${count(further.connections)} reached, sent ${amount(further.sent)}, received ${amount(further.received)}`,
    );
  return `And ${count(requests)} more ${requests === 1 ? "request" : "requests"} to other hosts: ${parts.join("; ")}.`;
}

/**
 * The section a run's answer ends with, after everything the script printed:
 * a line for each host named, and one counting the rest.
 */
export function networkSection(
  reached: readonly HostReach[] | undefined,
  further?: FurtherHosts,
): string {
  const lines = (reached ?? []).map((reach) => {
    const parts: string[] = [];
    if (reach.connections)
      parts.push(
        `sent ${amount(reach.sent)}, received ${amount(reach.received)}`,
      );
    if (reach.refused) parts.push(`refused: ${reach.refused}`);
    if (reach.failed) parts.push(`could not be reached: ${reach.failed}`);
    return `${named(reach)}: ${parts.join("; ")}.`;
  });
  if (further) lines.push(furtherLine(further));
  return `${heading}${lines.length ? lines.join("\n") : "It reached no host."}`;
}

/** The text a finished call answered with. */
function answered(result: ToolInvocationResult): string {
  if (!result.ok) return result.reason;
  const content = (result.value as { content?: unknown } | undefined)?.content;
  return Array.isArray(content)
    ? content
        .map((part: { type?: unknown; text?: unknown }) =>
          part?.type === "text" && typeof part.text === "string"
            ? part.text
            : "",
        )
        .join("\n")
    : "";
}

/**
 * The network section of a finished run, for the person to read. Only a run
 * that named hosts has one, and it is always last, so what the script
 * printed before it cannot stand in for it.
 */
export function networkDetail(
  namedHosts: boolean,
  result: ToolInvocationResult,
): readonly ActionDetail[] {
  if (!namedHosts) return [];
  const text = answered(result);
  const at = text.lastIndexOf(heading);
  if (at < 0) return [];
  return [
    { kind: "text", label: "Network", text: text.slice(at + heading.length) },
  ];
}
