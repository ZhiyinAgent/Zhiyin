/**
 * A long conversation the assistant is still writing into, sent to the window
 * the way the core sends it: whole once, then the new words every 40 ms. It is
 * where typing while text streams is measured, and where a person's place is
 * kept while the window changes width: its paragraphs rewrap.
 */

import {
  emptyConversationLists,
  WindowCopy,
  type TaskAction,
  type TaskMessage,
  type WorkspaceSnapshot,
  type WorkspaceTask,
} from "@zhiyin/contract";
import type { WorkspaceAction } from "../ui/app/index.js";

const taskId = "long-conversation";
const streamingId = "long-streaming";

const answer = `The figures for this part are in, and they change the picture a little. Most of the growth came from contracts signed late in the quarter.

The northern region carried the quarter: two new contracts started in its last month, and both clients have already asked about renewing at the same terms. The southern region lost one client to a competitor's lower price, and held every other account at its previous level.

- **Revenue** rose against the last quarter, mostly in the northern region.
- **Costs** stayed flat, apart from one supplier whose prices went up.

| Region | Change | Note |
| --- | --- | --- |
| North | +12% | New contracts |
| South | −3% | One client left |

The next part covers what this means for the forecast.`;

/** A hundred exchanges, each a question, a read and an answer: 300 blocks. */
function longTask(): WorkspaceTask {
  const messages: TaskMessage[] = [];
  const actions: TaskAction[] = [];
  for (let turn = 0; turn < 100; turn += 1) {
    messages.push({
      id: `long-user-${turn}`,
      role: "user",
      text: `Go through part ${turn + 1} of the quarterly report.`,
      sequence: turn * 3,
    });
    actions.push({
      id: `long-read-${turn}`,
      action: "Read a file",
      target: `reports/part-${turn + 1}.md`,
      status: "completed",
      sequence: turn * 3 + 1,
    });
    messages.push({
      id: `long-answer-${turn}`,
      role: "assistant",
      text: answer,
      sequence: turn * 3 + 2,
    });
  }
  messages.push({
    id: "long-user-last",
    role: "user",
    text: "Sum the whole report up.",
    sequence: 300,
  });
  messages.push({
    id: streamingId,
    role: "assistant",
    text: "Across the hundred parts,",
    sequence: 301,
  });
  return {
    id: taskId,
    title: "The quarterly report",
    updatedLabel: "Now",
    titleSource: "generated" as const,
    updatedAt: "2026-10-05T09:00:00.000Z",
    ...emptyConversationLists,
    messages,
    actions,
    phase: { kind: "working", steps: [] },
  };
}

const words =
  " the report shows steady growth in the north, a small loss in the south, and costs that held except for one supplier.".split(
    /(?= )/,
  );

/** Starts the stream; the returned function stops it. */
export function streamIntoLongConversation(
  dispatch: (action: WorkspaceAction) => void,
): () => void {
  const copy = new WindowCopy();
  const snapshot: WorkspaceSnapshot = {
    runtime: { tasks: "available", capabilities: "available" },
    recentWorkspaces: [],
    preferences: { onboarded: true, interests: [] },
    tasks: [longTask()],
    selectedTaskId: taskId,
    plugins: [],
    mcpServers: [],
    usage: { status: "unavailable", reason: "None in the demo." },
  };
  const hydrated = copy.receive({ kind: "workspaceSnapshot", data: snapshot });
  if (hydrated?.snapshot)
    dispatch({ type: "workspaceHydrated", snapshot: hydrated.snapshot });
  let sequence = 0;
  const timer = window.setInterval(() => {
    sequence += 1;
    const update = copy.receive({
      kind: "taskUpdated",
      data: {
        taskId,
        sequence,
        appended: [
          {
            messageId: streamingId,
            text: words[sequence % words.length] ?? "",
          },
        ],
      },
    });
    if (update?.task) dispatch({ type: "taskReplaced", task: update.task });
  }, 40);
  return () => window.clearInterval(timer);
}
