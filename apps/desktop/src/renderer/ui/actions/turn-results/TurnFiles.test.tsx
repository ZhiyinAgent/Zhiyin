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
import { TurnFiles } from "./TurnFiles.js";
import { changedFiles, touchesFiles } from "./turnChanges.js";
import { ApprovalEvidence } from "../approvals/ApprovalEvidence.js";

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

/** A file of `count` lines, every one of them unlike another version's. */
function lines(count: number, tag: string): string {
  return Array.from({ length: count }, (_, at) => `${tag} line ${at}`).join(
    "\n",
  );
}

describe("a conversation drawn again while it streams", () => {
  // Rewriting a file of 1,500 lines takes about a tenth of a second to
  // compare; the window draws again every 40 ms while an answer streams.
  // c.ts is rewritten twice, so its row compares its first version to its
  // last.
  const rewrites = ["a.ts", "b.ts", "c.ts", "c.ts"].map((path, at) =>
    edit(`edit-${at}`, [
      {
        path,
        change: "updated",
        before: lines(1_500, `old ${at}`),
        after: lines(1_500, `new ${at}`),
      },
    ]),
  );

  it("does not compare a finished turn's files again on each drawing", () => {
    const { rerender } = render(
      <TurnFiles actions={rewrites} running={false} />,
    );
    const started = performance.now();

    for (let drawing = 0; drawing < 50; drawing += 1) {
      expect(touchesFiles(rewrites)).toBe(true);
      rerender(<TurnFiles actions={rewrites} running={false} />);
    }

    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("does not compare an approval's files again on each keystroke", () => {
    // One change per file, as an approval carries them.
    const changes = rewrites
      .slice(0, 3)
      .flatMap((action) => action.changes ?? []);
    const evidence = () => (
      <ApprovalEvidence
        title="Edit files"
        target=""
        invocation={undefined}
        changes={changes}
        disabled={false}
        onReview={() => undefined}
        onReviewCode={() => undefined}
      />
    );
    const { rerender } = render(evidence());
    const started = performance.now();

    for (let keystroke = 0; keystroke < 50; keystroke += 1)
      rerender(evidence());

    expect(performance.now() - started).toBeLessThan(1_500);
  });
});

describe("the files a turn changed", () => {
  it("writes out hidden characters in each file's name, its button and why no copy was kept", () => {
    render(
      <TurnFiles
        actions={[
          edit(
            "write-bills",
            [
              { path: "bills/inv‮fdp.exe", change: "created", after: "x" },
              { path: "notes‮.md", change: "created", after: "y" },
            ],
            {
              recovery: {
                files: [
                  {
                    path: "bills/inv‮fdp.exe",
                    status: "unprotected",
                    reason: "Too large‮ to copy.",
                  },
                ],
              },
            },
          ),
        ]}
        running={false}
      />,
    );

    expect(panel()).toHaveTextContent("bills/inv[U+202E]fdp.exe");
    expect(panel()).toHaveTextContent("No copy: Too large[U+202E] to copy.");
    expect(
      within(panel()).getByRole("button", { name: "Review notes[U+202E].md" }),
    ).toBeVisible();
    expect(panel().outerHTML).not.toContain("‮");
  });

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

  it("counts a large file's lines from the change it carries, and opens it", () => {
    const diff = {
      added: 1,
      removed: 1,
      sections: [
        { kind: "skipped" as const, count: 4000 },
        {
          kind: "lines" as const,
          lines: [
            { kind: "removed" as const, beforeLine: 4001, text: "old row" },
            { kind: "added" as const, afterLine: 4001, text: "new row" },
          ],
        },
      ],
    };
    render(
      <TurnFiles
        actions={[edit("big", [{ path: "data.csv", change: "updated", diff }])]}
        running={false}
      />,
    );

    expect(within(panel()).getAllByText("+1")[0]).toBeVisible();
    fireEvent.click(
      within(panel()).getByRole("button", { name: "Review data.csv" }),
    );
    expect(
      within(screen.getByRole("dialog")).getByText("new row"),
    ).toBeVisible();
  });

  it("says a large file changed more than once cannot be shown as one change", () => {
    const diff = { added: 1, removed: 0, sections: [] };
    const [file] = changedFiles([
      edit("first", [{ path: "data.csv", change: "updated", diff }]),
      edit("second", [{ path: "data.csv", change: "updated", diff }]),
    ]);

    expect(file?.change.omitted).toMatch(/more than once/);
    expect(file?.added).toBeUndefined();
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

/** A `move_file` that ran, declaring each file at both ends as the tool does. */
function move(
  id: string,
  moves: readonly (readonly [from: string, to: string])[],
): TaskAction {
  return edit(id, [
    ...moves.map(([from, to]) => ({
      path: from,
      change: "moved" as const,
      to,
    })),
    ...moves.map(([from, to]) => ({
      path: to,
      change: "created" as const,
      from,
    })),
  ]);
}

/** The row for one path in the turn's panel. */
function row(path: string): HTMLElement {
  const found = within(panel())
    .getAllByRole("listitem")
    .find(
      (item) =>
        within(item).getByTestId("path").getAttribute("data-tip") === path,
    );
  if (!found) throw new Error(`No row for ${path}`);
  return found;
}

describe("the files a turn moved", () => {
  it("says where a renamed file went and where it came from, and counts it as one file", () => {
    render(
      <TurnFiles
        actions={[move("rename", [["notes.md", "kept/notes.md"]])]}
        running={false}
        onPreviewUndo={vi.fn()}
        onCommitUndo={vi.fn()}
      />,
    );

    expect(
      within(panel()).getByRole("heading", { name: "1 file changed" }),
    ).toBeVisible();
    expect(row("notes.md")).toHaveTextContent("Moved to kept/notes.md");
    expect(row("kept/notes.md")).toHaveTextContent("Moved here from notes.md");
    // The file is the same at both ends: there is no difference to open.
    expect(
      within(panel()).queryByRole("button", { name: /^Review/ }),
    ).toBeNull();
    expect(
      within(panel()).getByRole("button", { name: "Undo these changes" }),
    ).toBeVisible();
  });

  it("names each file of a moved folder at both ends", () => {
    render(
      <TurnFiles
        actions={[
          move("folder", [
            ["drafts/a.md", "archive/drafts/a.md"],
            ["drafts/b.md", "archive/drafts/b.md"],
          ]),
        ]}
        running={false}
      />,
    );

    expect(
      within(panel()).getByRole("heading", { name: "2 files changed" }),
    ).toBeVisible();
    expect(row("drafts/a.md")).toHaveTextContent(
      "Moved to archive/drafts/a.md",
    );
    expect(row("drafts/b.md")).toHaveTextContent(
      "Moved to archive/drafts/b.md",
    );
    expect(row("archive/drafts/b.md")).toHaveTextContent(
      "Moved here from drafts/b.md",
    );
  });

  it("names a file moved out of the folder by its whole path", () => {
    render(
      <TurnFiles
        actions={[
          move("out", [["notes.md", "C:\\Users\\Léa\\Documents\\notes.md"]]),
        ]}
        running={false}
      />,
    );

    expect(row("notes.md")).toHaveTextContent(
      "Moved to C:\\Users\\Léa\\Documents\\notes.md",
    );
    expect(row("C:\\Users\\Léa\\Documents\\notes.md")).toHaveTextContent(
      "Moved here from notes.md",
    );
  });

  it("shows a file the turn wrote and then moved as new where it ended up, with its lines", () => {
    render(
      <TurnFiles
        actions={[
          edit("write", [
            { path: "draft.md", change: "created", after: "one\ntwo\n" },
          ]),
          move("rename", [["draft.md", "kept/draft.md"]]),
        ]}
        running={false}
      />,
    );

    expect(
      within(panel()).getByRole("heading", { name: "1 file changed" }),
    ).toBeVisible();
    expect(row("draft.md")).toHaveTextContent("Moved to kept/draft.md");
    expect(row("kept/draft.md")).toHaveTextContent("Moved here from draft.md");
    expect(within(panel()).getByText("+2")).toBeVisible();

    fireEvent.click(
      within(row("kept/draft.md")).getByRole("button", {
        name: "Review kept/draft.md",
      }),
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("one")).toBeVisible();
    expect(within(dialog).getByText("two")).toBeVisible();
  });

  it("shows a file moved in and then edited as that edit, where it is now", () => {
    const actions = [
      move("rename", [["notes.md", "kept/notes.md"]]),
      edit("edit", [
        {
          path: "kept/notes.md",
          change: "updated",
          before: "a\nb\n",
          after: "a\nc\n",
        },
      ]),
    ];
    render(<TurnFiles actions={actions} running={false} />);

    expect(row("kept/notes.md")).toHaveTextContent(
      "Moved here from notes.md and edited",
    );
    expect(
      changedFiles(actions).find((file) => file.path === "kept/notes.md"),
    ).toEqual(expect.objectContaining({ added: 1, removed: 1 }));

    fireEvent.click(
      within(row("kept/notes.md")).getByRole("button", {
        name: "Review kept/notes.md",
      }),
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("b")).toBeVisible();
    expect(within(dialog).getByText("c")).toBeVisible();
  });

  it("carries an edit made before a move to where the file went", () => {
    const files = changedFiles([
      edit("edit", [
        { path: "notes.md", change: "updated", before: "a\n", after: "b\n" },
      ]),
      move("rename", [["notes.md", "kept/notes.md"]]),
    ]);

    expect(files).toEqual([
      expect.objectContaining({
        path: "notes.md",
        change: { path: "notes.md", change: "moved", to: "kept/notes.md" },
      }),
      expect.objectContaining({
        path: "kept/notes.md",
        change: expect.objectContaining({
          change: "created",
          from: "notes.md",
          before: "a\n",
          after: "b\n",
        }),
        added: 1,
        removed: 1,
      }),
    ]);
  });

  it("says when a new file took the place of one moved away", () => {
    render(
      <TurnFiles
        actions={[
          move("rename", [["notes.md", "kept/notes.md"]]),
          edit("write", [
            { path: "notes.md", change: "created", after: "fresh\n" },
          ]),
        ]}
        running={false}
      />,
    );

    expect(
      within(panel()).getByRole("heading", { name: "2 files changed" }),
    ).toBeVisible();
    expect(row("notes.md")).toHaveTextContent(
      "Moved to kept/notes.md; a new file took its place",
    );
  });

  it("says when a file was moved away and back", () => {
    render(
      <TurnFiles
        actions={[
          move("away", [["notes.md", "kept/notes.md"]]),
          move("back", [["kept/notes.md", "notes.md"]]),
        ]}
        running={false}
      />,
    );

    expect(row("notes.md")).toHaveTextContent(
      "Moved to kept/notes.md and back",
    );
    expect(row("kept/notes.md")).toHaveTextContent("Moved to notes.md");
  });
});

describe("the files a turn's commands changed", () => {
  it("are listed with what happened to each, with no review, and an undo only for what a command created", () => {
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
    expect(
      within(panel()).getByText("out.csv").closest("li"),
    ).toHaveTextContent("Created by a command");
    for (const path of ["data.csv", "old.csv"])
      expect(within(panel()).getByText(path).closest("li")).toHaveTextContent(
        "Changed by a command, so no copy was kept",
      );
    expect(within(panel()).getByText("old.csv").closest("li")).toContainElement(
      within(panel()).getByLabelText("Deleted permanently"),
    );
    expect(
      within(panel()).queryByRole("button", { name: /Review/ }),
    ).not.toBeInTheDocument();
    expect(
      within(panel()).getByRole("button", { name: "Undo these changes" }),
    ).toBeVisible();
  });

  it("offers no undo for a turn whose commands only changed or deleted files", () => {
    render(
      <TurnFiles
        actions={[
          command("convert", {
            status: "checked",
            files: [
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
      within(panel()).queryByRole("button", { name: /Undo/ }),
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
    ).toHaveTextContent("Created by a command that finished later");
  });

  it("offers no review of a PDF a command made, since nothing of it was kept", () => {
    render(
      <TurnFiles
        actions={[
          ...turn,
          command("build", {
            status: "checked",
            files: [{ path: "report.pdf", change: "created" }],
          }),
        ]}
        running={false}
        onCompareDocument={async () => ({ before: [], after: [] })}
      />,
    );

    expect(
      within(panel()).queryByRole("button", { name: "Review report.pdf" }),
    ).toBeNull();
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

  it("is shown for files only a command changed, and not for an edit that did not run", () => {
    expect(
      touchesFiles([
        command("unzip", {
          status: "checked",
          files: [{ path: "photos/1.jpg", change: "created" }],
        }),
      ]),
    ).toBe(true);
    expect(
      touchesFiles([
        edit(
          "edit-refused",
          [{ path: "plan.md", change: "updated", before: "a", after: "b" }],
          { status: "denied" },
        ),
      ]),
    ).toBe(false);
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

  it("asks the core once while the window draws again, and shows its answer", async () => {
    let answer: (comparison: DocumentComparison) => void = () => undefined;
    const compare = vi.fn<(path: string) => Promise<DocumentComparison>>(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const { rerender } = render(
      <TurnFiles
        actions={compiled}
        running={false}
        onCompareDocument={(path) => compare(path)}
      />,
    );
    fireEvent.click(
      within(panel()).getByRole("button", { name: "Review paper.pdf" }),
    );

    // Each drawing of the timeline hands a new function, as the app does.
    for (let drawing = 0; drawing < 3; drawing += 1)
      rerender(
        <TurnFiles
          actions={compiled}
          running={false}
          onCompareDocument={(path) => compare(path)}
        />,
      );
    answer({ before: ["Title"], after: ["Title\nNew line"] });

    expect(
      await within(screen.getByRole("dialog")).findByText("New line"),
    ).toBeVisible();
    expect(compare).toHaveBeenCalledTimes(1);
  });

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
