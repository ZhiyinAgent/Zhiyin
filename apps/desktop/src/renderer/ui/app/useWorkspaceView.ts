import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BrowserPanelState,
  DocumentPanelState,
  WorkspaceView,
} from "@zhiyin/contract";
import type { Surface } from "../workspace/index.js";
import type { WorkspaceCommands } from "./workspaceCommands.js";
import {
  selectedDocument,
  selectedWorkspaceView,
  type WorkspaceState,
} from "./workspaceState.js";

type OpenDocument = Exclude<DocumentPanelState, { status: "closed" }>;

/** What the space beside the conversation would draw. */
export type BesideConversation =
  | { readonly kind: "browser"; readonly browser: BrowserPanelState }
  | { readonly kind: "document"; readonly document: OpenDocument };

/**
 * What the space beside the selected conversation shows, as the core decided
 * (ADR 0018), and the person's ways to change it. The window holds no view of
 * its own: a choice goes to the core and comes back as the view, so the agent
 * and the person can never disagree about what is on screen.
 *
 * The one thing kept here is which surface was on screen last, so the
 * Workspace tab returns to it rather than to whichever surface comes first.
 */
export function useWorkspaceView(
  state: WorkspaceState,
  commands: Pick<
    WorkspaceCommands,
    "chooseWorkspaceView" | "drawDocumentPage" | "showDocument"
  >,
  act: (operation: () => Promise<unknown>) => Promise<void>,
) {
  const taskId = state.selectedTaskId;
  const browser = state.browser;
  const document = selectedDocument(state);
  const view = selectedWorkspaceView(state);
  const has = (surface: Surface) =>
    surface === "browser"
      ? browser.status !== "closed"
      : document.status !== "closed";
  const showing = view !== "conversation" && has(view) ? view : undefined;

  const [last, setLast] = useState<{
    taskId: string | null;
    surface: Surface;
  }>();
  if (showing && (last?.taskId !== taskId || last.surface !== showing))
    setLast({ taskId, surface: showing });
  const remembered = last?.taskId === taskId ? last.surface : undefined;
  const surface: Surface | undefined =
    showing ??
    (remembered && has(remembered)
      ? remembered
      : has("document")
        ? "document"
        : has("browser")
          ? "browser"
          : undefined);

  const beside = useMemo<BesideConversation | undefined>(
    () =>
      surface === "browser"
        ? { kind: "browser", browser }
        : surface === "document" && document.status !== "closed"
          ? { kind: "document", document }
          : undefined,
    [surface, browser, document],
  );

  const choose = (next: WorkspaceView) => {
    if (taskId) void act(() => commands.chooseWorkspaceView(taskId, next));
  };
  const drawPage = useCallback(
    (revision: string, page: number, width: number) =>
      taskId
        ? commands.drawDocumentPage(taskId, revision, page, width)
        : Promise.resolve({
            ok: false as const,
            reason: "This conversation has no document open.",
          }),
    [taskId, commands],
  );

  // A citation is drawn inside every answer, so what opens it must not change
  // with each render: that would draw every answer again on every token.
  const latestAct = useRef(act);
  useEffect(() => {
    latestAct.current = act;
  });
  const cite = useCallback(
    (path: string, page?: number) => {
      if (!taskId) return;
      void latestAct.current(async () => {
        const outcome = await commands.showDocument(taskId, path, page);
        if (!outcome.ok) throw new Error(outcome.reason);
      });
    },
    [taskId, commands],
  );

  return {
    /** What the space would show; nothing when the conversation has nothing. */
    beside,
    /** Whether the space is on screen. */
    open: showing !== undefined,
    /** Both surfaces are available, so the person can choose between them. */
    both: has("browser") && has("document"),
    /** Shows the conversation alone. */
    toConversation: () => choose("conversation"),
    /** Shows the space, with the surface it showed last. */
    toWorkspace: () => {
      if (surface) choose(surface);
    },
    choose,
    drawPage,
    /** Opens a document the agent cited, at its page (ADR 0018). */
    cite,
  };
}
