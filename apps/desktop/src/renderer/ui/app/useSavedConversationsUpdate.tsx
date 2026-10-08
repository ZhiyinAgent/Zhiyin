import { useState, type ReactNode } from "react";
import type { CoreApi } from "@zhiyin/contract";
import { SavedConversationsUpdate } from "../recovery/index.js";
import { listedConversations, type WorkspaceState } from "./workspaceState.js";

/**
 * The question about conversations an earlier version saved: asked once the
 * workspace shows, and again whenever the person asks, from the list, the
 * notice in a waiting conversation's place, or Settings. Later puts it away
 * until then; the next launch asks again. ADR 0022.
 */
export function useSavedConversationsUpdate(
  state: Pick<WorkspaceState, "tasks" | "conversations">,
  settle: CoreApi["settleSavedConversations"],
  showing: boolean,
): {
  readonly panel: ReactNode;
  /** Absent while nothing waits, or the core cannot carry out an answer. */
  readonly ask: (() => void) | undefined;
} {
  const [asking, setAsking] = useState(true);
  const waiting = listedConversations(state).flatMap((item) =>
    item.needsUpdate
      ? [{ title: item.title, writtenBy: item.needsUpdate.writtenBy }]
      : [],
  );
  if (!settle || !waiting.length) return { panel: null, ask: undefined };
  return {
    panel:
      showing && asking ? (
        <SavedConversationsUpdate
          waiting={waiting}
          onSettle={settle}
          onClose={() => setAsking(false)}
        />
      ) : null,
    ask: () => setAsking(true),
  };
}
