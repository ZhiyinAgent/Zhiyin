// What the window's shell tests share: the shell over the real reducer, and a
// turn that failed.
import { useReducer } from "react";
import {
  emptyConversationLists,
  type CoreApi,
  type TurnRemedy,
} from "@zhiyin/contract";
import {
  createWindowState,
  windowReducer,
  type WindowState,
} from "../windowState.js";
import { WindowShell } from "../WindowShell.js";

/** The shell with the real reducer, for flows that move between pages. */
export function Live({
  initial,
  commands,
}: {
  initial: WindowState;
  commands: CoreApi;
}) {
  const [state, dispatch] = useReducer(windowReducer, initial);
  return <WindowShell state={state} dispatch={dispatch} commands={commands} />;
}

/** One request that failed, offering what the loop said it can do next. */
export function failed(remedies?: readonly TurnRemedy[]) {
  return createWindowState({
    connection: "ready",
    runtime: { tasks: "available", capabilities: "available" },
    selectedTaskId: "task-1",
    tasks: [
      {
        id: "task-1",
        title: "Summarise the notes",
        updatedLabel: "Now",
        updatedAt: "2026-10-05T09:00:00.000Z",
        ...emptyConversationLists,
        reasoning: { enabled: true, effort: "high" },
        messages: [
          {
            id: "message-1",
            role: "user",
            text: "Summarise the notes",
            sequence: 0,
          },
        ],
        phase: {
          kind: "failed",
          reason: "The model connection stopped. Try again.",
          ...(remedies ? { remedies } : {}),
        },
      },
    ],
  });
}
