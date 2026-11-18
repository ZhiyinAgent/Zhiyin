/** Memory as the window shows and changes it, outside the Memory page (ADR 0026). */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useReducer } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  emptyConversationLists,
  memoryLimits,
  type CoreApi,
  type MemoryChange,
  type MemoryState,
} from "@zhiyin/contract";
import { WindowShell } from "./WindowShell.js";
import {
  createWindowState,
  windowReducer,
  type TaskAction,
  type WindowState,
} from "./windowState.js";
import { stubCommands } from "../../stubCommands.js";

const typst: MemoryChange = {
  writeId: "write-1",
  number: 41,
  title: "Typst over LaTeX",
  change: "added",
  scope: "everything",
  scopeName: "Everything you do",
  section: "knowledge",
};

const memory: MemoryState = {
  on: true,
  projects: [],
  entries: [
    {
      number: 41,
      scope: "everything",
      section: "knowledge",
      title: "Typst over LaTeX",
      summary: "The template needs a grid",
      text: "Chosen on 3 October.",
      written: "2026-10-31T09:00:00.000Z",
    },
  ],
  waiting: [],
  limits: memoryLimits,
  broadFolders: [],
};

/** A finished turn whose actions are `actions`, then the person's next message. */
function conversation(
  actions: readonly TaskAction[],
  phase: WindowState["tasks"][number]["phase"] = {
    kind: "completed",
    outcome: { title: "Done", summary: "Chose Typst." },
  },
): WindowState {
  return {
    ...createWindowState({
      connection: "ready",
      runtime: { tasks: "available", capabilities: "available" },
      selectedTaskId: "task-1",
      tasks: [
        {
          id: "task-1",
          title: "Template",
          updatedLabel: "Now",
          updatedAt: "2026-10-31T09:00:00.000Z",
          ...emptyConversationLists,
          messages: [
            {
              id: "message-1",
              role: "user",
              text: "Typst or LaTeX?",
              sequence: 0,
            },
            {
              id: "message-2",
              role: "assistant",
              text: "Typst.",
              sequence: 3,
            },
          ],
          actions,
          phase,
        },
      ],
    }),
    memory,
  };
}

function kept(change: MemoryChange, sequence: number): TaskAction {
  return {
    id: `action-${sequence}`,
    action: "Keep in memory",
    target: change.title,
    toolName: "remember",
    memory: change,
    status: "completed",
    sequence,
  } as TaskAction;
}

function Live({
  initial,
  commands,
}: {
  initial: WindowState;
  commands: CoreApi;
}) {
  const [state, dispatch] = useReducer(windowReducer, initial);
  return <WindowShell state={state} dispatch={dispatch} commands={commands} />;
}

describe("memory in the conversation", () => {
  it("shows what a finished turn kept on a card under it, and takes a write back with Undo", () => {
    const changeMemory = vi.fn<CoreApi["changeMemory"]>(async () => ({
      ok: true,
    }));
    render(
      <Live
        initial={conversation([kept(typst, 1)])}
        commands={{ ...stubCommands, changeMemory }}
      />,
    );

    const card = screen.getByRole("region", { name: "Memory" });
    expect(within(card).getByText("1 new")).toBeVisible();
    expect(card).toHaveTextContent("Everything you do · Knowledge");

    fireEvent.click(within(card).getByRole("button", { name: "Undo" }));
    expect(changeMemory).toHaveBeenCalledWith({
      kind: "undo",
      writeId: "write-1",
    });
  });

  it("opens the Memory page at the entry a row names", () => {
    render(
      <Live initial={conversation([kept(typst, 1)])} commands={stubCommands} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Typst over LaTeX" }));

    expect(
      screen.getByRole("article", { name: "Typst over LaTeX" }),
    ).toBeVisible();
    expect(screen.getByText("Chosen on 3 October.")).toBeVisible();
  });

  it("draws the look back's calls on no row, and shows what it kept on the turn's card as kept after the turn", () => {
    const lookedUp: TaskAction = {
      id: "action-5",
      action: "Read memory",
      target: "typst",
      toolName: "recall",
      status: "completed",
      sequence: 5,
    } as TaskAction;
    const onTurn: TaskAction = { ...lookedUp, id: "action-1", sequence: 1 };
    render(
      <Live
        initial={conversation([
          onTurn,
          { ...kept(typst, 4), lookBack: true },
          { ...lookedUp, lookBack: true },
        ])}
        commands={stubCommands}
      />,
    );

    expect(screen.getAllByText("Read memory")).toHaveLength(1);
    expect(screen.queryByText("Keep in memory")).toBeNull();
    const card = screen.getByRole("region", { name: "Memory" });
    expect(within(card).getByText("1 new")).toBeVisible();
    expect(card).toHaveTextContent(
      "Everything you do · Knowledge · after the turn",
    );
    fireEvent.click(
      within(card).getByRole("button", { name: "Typst over LaTeX" }),
    );
    expect(
      screen.getByRole("article", { name: "Typst over LaTeX" }),
    ).toBeVisible();
  });

  it("shows no card for a turn that kept nothing, nor while the turn is still working", () => {
    const { unmount } = render(
      <Live initial={conversation([])} commands={stubCommands} />,
    );
    expect(screen.queryByRole("region", { name: "Memory" })).toBeNull();
    unmount();

    render(
      <Live
        initial={conversation([kept(typst, 1)], {
          kind: "working",
          steps: [],
        })}
        commands={stubCommands}
      />,
    );
    expect(screen.queryByRole("region", { name: "Memory" })).toBeNull();
  });
});

describe("deleting a conversation that kept something", () => {
  const entry = memory.entries[0]!;
  /**
   * The conversation, with memory holding an entry it kept for itself and
   * one it kept for other conversations.
   */
  const keeping: WindowState = {
    ...conversation([kept(typst, 1)]),
    memory: {
      ...memory,
      entries: [
        { ...entry, conversation: { id: "task-1", title: "Template" } },
        {
          ...entry,
          number: 42,
          scope: "conversation:task-1",
          title: "Margins checked",
          conversation: { id: "task-1", title: "Template" },
        },
        // An instruction it added a rule to is the person's too: not offered.
        {
          number: 2,
          scope: "everything",
          section: "how",
          title: "How to work",
          summary: "",
          text: "- Answer in French.",
          written: "2026-10-31T09:00:00.000Z",
          conversation: { id: "task-1", title: "Template" },
        },
      ],
    },
  };
  const askToDelete = () => {
    fireEvent.contextMenu(screen.getByRole("button", { name: /^Template/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    return screen.getByRole("group", { name: "Delete Template" });
  };
  const drawn = (initial: WindowState) => {
    const deleteTask = vi.fn<CoreApi["deleteTask"]>(async () => {});
    const changeMemory = vi.fn<CoreApi["changeMemory"]>(async () => ({
      ok: true,
    }));
    render(
      <Live
        initial={initial}
        commands={{ ...stubCommands, deleteTask, changeMemory }}
      />,
    );
    return { deleteTask, changeMemory };
  };
  const forItself = "Forget the 1 entry it kept for itself";
  const forOthers = "Also forget the 1 entry it kept for other conversations";

  it("forgets what it kept for itself, and keeps what it kept for other conversations, unless the person changes the boxes", async () => {
    const { deleteTask, changeMemory } = drawn(keeping);

    const question = askToDelete();
    expect(
      within(question).getByRole("checkbox", { name: forItself }),
    ).toBeChecked();
    expect(
      within(question).getByRole("checkbox", { name: forOthers }),
    ).not.toBeChecked();
    fireEvent.click(
      within(question).getByRole("button", { name: "Delete conversation" }),
    );

    await waitFor(() =>
      expect(changeMemory).toHaveBeenCalledWith({
        kind: "forgetConversation",
        taskId: "task-1",
        own: true,
      }),
    );
    expect(deleteTask).toHaveBeenCalledWith("task-1");
  });

  it("forgets what it kept for other conversations too when the person ticks it", async () => {
    const { changeMemory } = drawn(keeping);

    const question = askToDelete();
    fireEvent.click(
      within(question).getByRole("checkbox", { name: forOthers }),
    );
    fireEvent.click(
      within(question).getByRole("button", { name: "Delete conversation" }),
    );

    await waitFor(() =>
      expect(changeMemory).toHaveBeenCalledWith({
        kind: "forgetConversation",
        taskId: "task-1",
        own: true,
        general: true,
      }),
    );
  });

  it("deletes only the conversation when the person unticks forgetting", async () => {
    const { deleteTask, changeMemory } = drawn(keeping);

    const question = askToDelete();
    fireEvent.click(
      within(question).getByRole("checkbox", { name: forItself }),
    );
    fireEvent.click(
      within(question).getByRole("button", { name: "Delete conversation" }),
    );

    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith("task-1"));
    expect(changeMemory).not.toHaveBeenCalled();
  });

  it("offers only what the conversation kept", () => {
    drawn({
      ...keeping,
      memory: { ...memory, entries: [keeping.memory!.entries[1]!] },
    });

    const question = askToDelete();
    expect(within(question).getAllByRole("checkbox")).toHaveLength(1);
    expect(
      within(question).getByRole("checkbox", { name: forItself }),
    ).toBeChecked();
  });

  it("offers nothing to forget for a conversation that kept nothing", () => {
    render(<Live initial={conversation([])} commands={stubCommands} />);

    expect(within(askToDelete()).queryByRole("checkbox")).toBeNull();
  });
});

describe("the Memory page's folder", () => {
  it("is opened by the core when the person asks", () => {
    const openMemoryFolder = vi.fn<CoreApi["openMemoryFolder"]>(async () => {});
    render(
      <Live
        initial={{ ...conversation([]), surface: "memory" }}
        commands={{ ...stubCommands, openMemoryFolder }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open memory folder" }));

    expect(openMemoryFolder).toHaveBeenCalledOnce();
  });
});
