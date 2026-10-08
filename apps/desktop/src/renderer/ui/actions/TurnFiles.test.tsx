import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  DocumentComparison,
  TaskAction,
  TaskUndo,
  UndoPreview,
} from "@zhiyin/contract";
import { TurnFiles, changedFiles, touchesFiles } from "./TurnFiles.js";

function edit(
  id: string,
  changes: TaskAction["changes"],
  overrides: Partial<TaskAction> = {},
): TaskAction {
  return {
    id,
    action: "Edit a file",
    target: "",
    status: "completed",
    sequence: 1,
    ...(changes ? { changes } : {}),
    ...overrides,
  };
}

/** Two `multi_edit`s and one `write_file`, as a turn would record them. */
const turn: TaskAction[] = [
  edit("edit-plan", [
    {
      path: "plan.md",
      change: "updated",
      before: "one\ntwo\nthree\n",
      after: "one\n2\nthree\nfour\n",
    },
  ]),
  edit("edit-notes", [
    { path: "notes.md", change: "updated", before: "a\nb\n", after: "a\n" },
  ]),
  edit("write-report", [
    { path: "report.md", change: "created", after: "# Report\nDone.\n" },
  ]),
];

function panel() {
  return screen.getByRole("region", { name: /changed/i });
}

describe("the files a turn changed", () => {
  it("counts the files and the lines added and removed", () => {
    render(<TurnFiles actions={turn} running={false} />);

    expect(
      within(panel()).getByRole("heading", { name: "3 files changed" }),
    ).toBeVisible();
    expect(within(panel()).getByText("+4")).toBeVisible();
    expect(within(panel()).getByText("−2")).toBeVisible();
    expect(
      within(panel())
        .getAllByRole("listitem")
        .map((row) => within(row).getByTestId("path").textContent),
    ).toEqual(["plan.md", "notes.md", "report.md"]);
  });

  it("opens each file's difference from its row", () => {
    render(<TurnFiles actions={turn} running={false} />);

    fireEvent.click(
      within(panel()).getByRole("button", { name: "Review notes.md" }),
    );

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByText("notes.md")[0]).toBeVisible();
    expect(within(dialog).getByText("b")).toBeVisible();
  });

  it("shows two changes to one file as one row, from the first version to the last", () => {
    const files = changedFiles([
      edit("first", [
        { path: "plan.md", change: "updated", before: "v1\n", after: "v2\n" },
      ]),
      edit("second", [
        { path: "plan.md", change: "updated", before: "v2\n", after: "v3\n" },
      ]),
    ]);

    expect(files).toEqual([
      expect.objectContaining({
        path: "plan.md",
        change: expect.objectContaining({ before: "v1\n", after: "v3\n" }),
        added: 1,
        removed: 1,
      }),
    ]);
  });

  it("leaves out what never ran", () => {
    expect(
      changedFiles([
        edit("denied", turn[0]!.changes, { status: "denied" }),
        edit("failed", turn[1]!.changes, { status: "failed" }),
      ]),
    ).toEqual([]);
  });

  it("says plainly when a file went to the Recycle Bin, was deleted, or has no copy, and offers no undo when nothing can be put back", () => {
    render(
      <TurnFiles
        actions={[
          edit("recycle", [{ path: "old.txt", change: "recycled" }]),
          edit("delete", [{ path: "gone.txt", change: "deleted" }]),
          edit(
            "big",
            [{ path: "data.csv", change: "updated", omitted: "Too large." }],
            {
              recovery: {
                files: [
                  {
                    path: "data.csv",
                    status: "unprotected",
                    reason: "Too large to keep a copy.",
                  },
                ],
              },
            },
          ),
        ]}
        running={false}
        onPreviewUndo={vi.fn()}
        onCommitUndo={vi.fn()}
      />,
    );

    expect(within(panel()).getByText("In the Recycle Bin")).toBeVisible();
    expect(within(panel()).getByText("Deleted permanently")).toBeVisible();
    expect(
      within(panel()).getByText("No copy: Too large to keep a copy."),
    ).toBeVisible();
    expect(
      within(panel()).queryByRole("button", { name: /Undo/ }),
    ).not.toBeInTheDocument();
  });

  it("undoes after showing what will go back and what will stay", async () => {
    const preview: UndoPreview = {
      id: "undo-1",
      taskId: "task-1",
      messageId: "u1",
      files: [
        { path: "plan.md", action: "restore", status: "recoverable" },
        { path: "report.md", action: "remove", status: "recoverable" },
        { path: "notes.md", action: "restore", status: "conflict" },
      ],
    };
    const commit = vi.fn(async () => ({ files: [] }));
    render(
      <TurnFiles
        actions={turn}
        running={false}
        onPreviewUndo={async () => preview}
        onCommitUndo={commit}
      />,
    );

    fireEvent.click(
      within(panel()).getByRole("button", { name: "Undo these changes" }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Undo these changes",
    });
    expect(within(dialog).getByText("plan.md").closest("li")).toHaveTextContent(
      "Goes back to how it was.",
    );
    expect(
      within(dialog).getByText("report.md").closest("li"),
    ).toHaveTextContent("Removed, as this turn created it.");
    expect(
      within(dialog).getByText("notes.md").closest("li"),
    ).toHaveTextContent(
      "You changed this file afterwards, so it will not be touched.",
    );
    expect(commit).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Undo changes" }),
    );
    await waitFor(() => expect(commit).toHaveBeenCalledWith("undo-1"));
  });

  it("shows an undone turn as undone, file by file, with no second undo", () => {
    const undone: TaskUndo = {
      id: "undo-1",
      messageId: "u1",
      actionIds: ["edit-plan", "edit-notes", "write-report"],
      at: "2026-10-02T09:00:00.000Z",
      files: [
        { path: "plan.md", status: "restored" },
        { path: "report.md", status: "removed" },
        { path: "notes.md", status: "conflict" },
      ],
    };
    render(
      <TurnFiles
        actions={turn}
        undone={undone}
        running={false}
        onPreviewUndo={vi.fn()}
        onCommitUndo={vi.fn()}
      />,
    );

    expect(within(panel()).getByText("Undone")).toBeVisible();
    const row = (path: string) => within(panel()).getByText(path).closest("li");
    expect(row("plan.md")).toHaveTextContent("Put back");
    expect(row("report.md")).toHaveTextContent("Removed");
    expect(row("notes.md")).toHaveTextContent(
      "You changed it afterwards, so it was left as it is",
    );
    expect(
      within(panel()).queryByRole("button", { name: /Undo/ }),
    ).not.toBeInTheDocument();
  });

  it("shows no file summary while the turn is still working", () => {
    render(
      <TurnFiles
        actions={turn}
        running
        onPreviewUndo={vi.fn()}
        onCommitUndo={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("region", { name: /changed/i }),
    ).not.toBeInTheDocument();
  });

  it("lists five files and the rest on request", () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      edit(`write-${index}`, [
        { path: `file-${index}.md`, change: "created", after: "x\n" },
      ]),
    );
    render(<TurnFiles actions={many} running={false} />);

    expect(within(panel()).getAllByRole("listitem")).toHaveLength(5);
    fireEvent.click(
      within(panel()).getByRole("button", { name: "Show 3 more" }),
    );
    expect(within(panel()).getAllByRole("listitem")).toHaveLength(8);
  });
});

/** A shell command's action, with what changed in its folder while it ran. */
function command(
  id: string,
  commandChanges: TaskAction["commandChanges"],
  overrides: Partial<TaskAction> = {},
): TaskAction {
  return {
    id,
    action: "Run a command",
    target: "python convert.py",
    status: "completed",
    sequence: 1,
    ...(commandChanges ? { commandChanges } : {}),
    ...overrides,
  };
}

describe("the files a turn's commands changed", () => {
  it("are listed with what happened to each, with no review and no undo, since no copy was kept", () => {
    render(
      <TurnFiles
        actions={[
          command("convert", {
            status: "checked",
            files: [
              { path: "out.csv", change: "created" },
              { path: "data.csv", change: "updated" },
              { path: "old.csv", change: "deleted" },
            ],
          }),
        ]}
        running={false}
        onPreviewUndo={vi.fn()}
        onCommitUndo={vi.fn()}
      />,
    );

    expect(
      within(panel()).getByRole("heading", { name: "3 files changed" }),
    ).toBeVisible();
    for (const path of ["out.csv", "data.csv", "old.csv"])
      expect(within(panel()).getByText(path).closest("li")).toHaveTextContent(
        "Changed by a command, so no copy was kept",
      );
    expect(within(panel()).getByText("old.csv").closest("li")).toContainElement(
      within(panel()).getByLabelText("Deleted"),
    );
    expect(
      within(panel()).queryByRole("button", { name: /Review|Undo/ }),
    ).not.toBeInTheDocument();
  });

  it("marks what a command changed after it carried on and finished later", () => {
    render(
      <TurnFiles
        actions={[
          command("build", {
            status: "checked",
            job: "J1",
            files: [{ path: "report.pdf", change: "created" }],
          }),
        ]}
        running={false}
      />,
    );

    expect(
      within(panel()).getByText("report.pdf").closest("li"),
    ).toHaveTextContent(
      "Changed by a command that finished later, so no copy was kept",
    );
  });

  it("says why what commands changed is not listed, even when no file is", () => {
    const actions = [
      command("convert", {
        status: "unchecked",
        reason:
          "This folder has more than 20,000 files, too many to check what commands change.",
      }),
    ];
    expect(changedFiles(actions)).toEqual([]);
    expect(touchesFiles(actions)).toBe(true);

    render(<TurnFiles actions={actions} running={false} />);

    expect(panel()).toHaveTextContent(
      "Files changed by commands are not listed. This folder has more than 20,000 files, too many to check what commands change.",
    );
  });

  it("says a command still running is listed when it ends, and counts files beyond those named", () => {
    render(
      <TurnFiles
        actions={[
          command("build", { status: "running", job: "J2" }),
          command("unzip", {
            status: "checked",
            files: [{ path: "photos/1.jpg", change: "created" }],
            more: 240,
          }),
        ]}
        running={false}
      />,
    );

    expect(
      within(panel()).getByRole("heading", { name: "241 files changed" }),
    ).toBeVisible();
    expect(panel()).toHaveTextContent(
      "A command is still running; what it changes is listed when it ends.",
    );
    expect(panel()).toHaveTextContent(
      "240 more files changed while commands ran.",
    );
  });

  it("keeps review and undo for a file a copy was taken for, and says a command changed it too", async () => {
    const preview: UndoPreview = {
      id: "undo-1",
      taskId: "task-1",
      messageId: "u1",
      files: [{ path: "plan.md", action: "restore", status: "conflict" }],
    };
    render(
      <TurnFiles
        actions={[
          turn[0]!,
          command("format", {
            status: "checked",
            files: [
              { path: "plan.md", change: "updated" },
              { path: "out.csv", change: "created" },
            ],
          }),
        ]}
        running={false}
        onPreviewUndo={async () => preview}
        onCommitUndo={vi.fn()}
      />,
    );

    expect(
      within(panel()).getByText("plan.md").closest("li"),
    ).toHaveTextContent("A command changed it too");
    expect(
      within(panel()).getByRole("button", { name: "Review plan.md" }),
    ).toBeVisible();
    fireEvent.click(
      within(panel()).getByRole("button", { name: "Undo these changes" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Undo these changes" }),
    ).toHaveTextContent(
      "Files a command changed stay as they are, as no copy was kept of them.",
    );
  });

  it("is not shown for a command that changed nothing", () => {
    const actions = [command("list", { status: "checked", files: [] })];

    expect(touchesFiles(actions)).toBe(false);
  });
});

describe("a PDF a compile wrote over", () => {
  const compiled = [
    edit("compile", [
      {
        path: "paper.pdf",
        change: "updated",
        omitted: "Its contents are known only once it is compiled.",
      },
    ]),
  ];

  function reviewPaper(
    compare: (path: string) => Promise<DocumentComparison>,
    undone?: TaskUndo,
  ) {
    render(
      <TurnFiles
        actions={compiled}
        running={false}
        onCompareDocument={compare}
        {...(undone ? { undone } : {})}
      />,
    );
    fireEvent.click(
      within(panel()).getByRole("button", { name: "Review paper.pdf" }),
    );
    return screen.getByRole("dialog");
  }

  it("shows the words that changed, under the page they are on", async () => {
    const compare = vi.fn(async () => ({
      before: ["Title\nResults were weak", "Second page"],
      after: ["Title", "Second page\nEverything holds up"],
    }));

    const dialog = reviewPaper(compare);

    expect(
      await within(dialog).findByText("Words changed on pages 1 and 2"),
    ).toBeVisible();
    expect(within(dialog).getByText("Page 1")).toBeVisible();
    expect(within(dialog).getByText("Results were weak")).toBeVisible();
    expect(within(dialog).getByText("Page 2")).toBeVisible();
    expect(within(dialog).getByText("Everything holds up")).toBeVisible();
    expect(compare).toHaveBeenCalledWith("paper.pdf");
  });

  it("says why the change cannot be shown", async () => {
    const dialog = reviewPaper(async () => {
      throw new Error(
        "paper.pdf has changed since, so the change can no longer be shown.",
      );
    });

    expect(
      await within(dialog).findByText(
        "paper.pdf has changed since, so the change can no longer be shown.",
      ),
    ).toBeVisible();
  });

  it("says when its words are the same, and that nothing else is compared", async () => {
    const dialog = reviewPaper(async () => ({
      before: ["Same words"],
      after: ["Same words"],
    }));

    expect(
      await within(dialog).findByText(
        "The words are the same in both versions. Anything else that changed, such as its layout, pictures or fonts, is not compared here.",
      ),
    ).toBeVisible();
  });

  it("offers no review once the turn was undone, as the earlier version is back", () => {
    render(
      <TurnFiles
        actions={compiled}
        running={false}
        onCompareDocument={async () => ({ after: [] })}
        undone={{
          id: "undo-1",
          messageId: "m1",
          actionIds: ["compile"],
          at: "2026-10-05T10:00:00.000Z",
          files: [{ path: "paper.pdf", status: "restored" }],
        }}
      />,
    );

    expect(
      within(panel()).queryByRole("button", { name: "Review paper.pdf" }),
    ).toBeNull();
  });
});
