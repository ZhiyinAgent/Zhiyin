/**
 * What the person sees of a document the main agent reads or closes (ADR 0018).
 *
 * Reading a workspace document shows it beside the conversation, whether or
 * not the read succeeded, so the person sees what the agent was told. The
 * answer then says what the person sees, so the agent never reports showing
 * something they cannot see (ADR 0005). Showing never fails the read: if the
 * app cannot say, the read's own answer stands.
 */

import type { ToolInvocationResult } from "@zhiyin/contract";
import type { AgentLoopDependencies } from "../dependencies.js";

type Host = Pick<
  AgentLoopDependencies["host"],
  "documentRead" | "documentClose"
>;

export async function shownToPerson(
  host: Host,
  taskId: string,
  document: { readonly path: string; readonly page?: number },
  result: ToolInvocationResult,
): Promise<ToolInvocationResult> {
  const shown = await host
    .documentRead(taskId, document.path, document.page)
    .catch(() => undefined);
  const told = shown ? { ...result, shown } : result;
  return told.ok ? { ...told, cite: citation(document.path) } : told;
}

/**
 * The exact link to cite this document with (ADR 0018), so the model never
 * builds one. Each segment of the path is percent-encoded, brackets too, so
 * nothing in a file's name can break the Markdown link.
 */
function citation(path: string): string {
  const link = path
    .split("/")
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[()]/g,
        (bracket) => `%${bracket.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
  return path.toLowerCase().endsWith(".pdf")
    ? `Cite a page of this document as [page N](${link}#page=N), with N the page.`
    : `Cite this picture as [${path.split("/").at(-1) ?? path}](${link}).`;
}

/** Closes the document beside the conversation, saying what is shown now. */
export async function closedForPerson(
  host: Host,
  taskId: string,
  result: ToolInvocationResult,
): Promise<ToolInvocationResult> {
  if (!result.ok) return result;
  try {
    return { ...result, shown: await host.documentClose(taskId) };
  } catch {
    return { ok: false, reason: "The document could not be closed." };
  }
}
