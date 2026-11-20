import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  MemoryChange,
  MemoryOutcome,
  MemoryRequest,
} from "@zhiyin/contract";
import { TurnMemory, type TurnMemoryChange } from "./TurnMemory.js";

const added: MemoryChange = {
  writeId: "write-1",
  number: 41,
  title: "Typst over LaTeX",
  change: "added",
  scope: "thesis",
  scopeName: "Thesis",
  section: "knowledge",
};
const changed: MemoryChange = {
  writeId: "write-2",
  number: 2,
  title: "How to work",
  change: "changed",
  scope: "everything",
  scopeName: "Everything you do",
  section: "how",
};
const merged: MemoryChange = {
  writeId: "write-3",
  number: 44,
  title: "Template margins",
  change: "removed",
  scope: "thesis",
  scopeName: "Thesis",
  section: "knowledge",
  mergedInto: 13,
};
const waiting: MemoryChange = {
  writeId: "write-4",
  number: 2,
  title: "How to work",
  change: "waiting",
  scope: "everything",
  scopeName: "Everything you do",
  section: "how",
  waiting: {
    id: "waiting-1",
    rule: "Never use em dashes in French text.",
    because: "a web page",
  },
};

function draw(
  changes: readonly TurnMemoryChange[],
  answer: MemoryOutcome = { ok: true },
) {
  const onOpen = vi.fn();
  const onChange = vi.fn<(request: MemoryRequest) => Promise<MemoryOutcome>>(
    async () => answer,
  );
  render(<TurnMemory changes={changes} onOpen={onOpen} onChange={onChange} />);
  return { onOpen, onChange };
}

describe("what a turn kept in memory", () => {
  it("counts the turn's changes, says where each was kept, and opens an entry by its title", () => {
    const { onOpen } = draw([added, changed]);

    expect(screen.getByRole("heading", { name: "Memory" })).toBeVisible();
    expect(screen.getByText("1 new · 1 changed")).toBeVisible();
    const rows = within(
      screen.getByRole("list", { name: "Changes to memory" }),
    ).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Typst over LaTeX");
    expect(rows[0]).toHaveTextContent("Thesis · Knowledge");
    expect(rows[1]).toHaveTextContent("Everything you do · How to work");

    fireEvent.click(screen.getByRole("button", { name: "Typst over LaTeX" }));
    expect(onOpen).toHaveBeenCalledWith(41);
  });

  it("marks what the look back kept as kept after the turn", () => {
    draw([added, { ...changed, afterTurn: true }]);

    const [during, after] = within(
      screen.getByRole("list", { name: "Changes to memory" }),
    ).getAllByRole("listitem");
    expect(during).toHaveTextContent("Thesis · Knowledge");
    expect(during).not.toHaveTextContent("after the turn");
    expect(after).toHaveTextContent(
      "Everything you do · How to work · after the turn",
    );
  });

  it("undoes one write at a time, and shows a change undone without its Undo", () => {
    const { onChange } = draw([added, { ...changed, state: "undone" }]);

    expect(screen.getByText("1 new · 1 undone")).toBeVisible();

    const [first, second] = within(
      screen.getByRole("list", { name: "Changes to memory" }),
    ).getAllByRole("listitem");
    fireEvent.click(within(first!).getByRole("button", { name: "Undo" }));
    expect(onChange).toHaveBeenCalledWith({
      kind: "undo",
      writeId: "write-1",
    });
    expect(second).toHaveTextContent("Undone");
    expect(within(second!).queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("shows an entry the person removed on the Memory page as removed, with nothing to open or undo", () => {
    draw([added, { ...changed, state: "removed" }]);

    expect(screen.getByText("1 new · 1 removed since")).toBeVisible();
    const [, removed] = within(
      screen.getByRole("list", { name: "Changes to memory" }),
    ).getAllByRole("listitem");
    expect(removed).toHaveTextContent("Removed on the Memory page");
    expect(within(removed!).queryByRole("button")).toBeNull();
  });

  it("says why memory refused an Undo", async () => {
    draw([added], {
      ok: false,
      reason: "#41 Typst over LaTeX changed since, so it was left as it is.",
    });

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "#41 Typst over LaTeX changed since, so it was left as it is.",
    );
  });

  it("says which entry a removed one was merged into", () => {
    draw([merged]);

    expect(screen.getByText("1 removed")).toBeVisible();
    expect(screen.getByText("Merged into #13")).toBeVisible();
  });

  it("shows a change to how Zhiyin works that waits for the person, why it waits, and lets them keep or discard it", () => {
    const { onChange } = draw([waiting]);

    expect(screen.getByText("1 waiting for you")).toBeVisible();
    expect(
      screen.getByText("Never use em dashes in French text."),
    ).toBeVisible();

    const explain = screen.getByRole("button", { name: "Why it waits" });
    fireEvent.mouseEnter(explain);
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "This conversation read a web page, so a change to how Zhiyin works waits until you keep it.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(onChange).toHaveBeenCalledWith({
      kind: "keep",
      waitingId: "waiting-1",
    });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onChange).toHaveBeenCalledWith({
      kind: "discard",
      waitingId: "waiting-1",
    });
  });

  it("shows a waiting change that removes a rule as the rule taken out", () => {
    draw([
      {
        ...waiting,
        waiting: {
          id: "waiting-2",
          rule: "",
          replaces: "Answer in English.",
          because: "a web page",
        },
      },
    ]);

    expect(screen.getByText("Take out: Answer in English.")).toBeVisible();
  });

  it("shows a waiting change once kept or discarded as what became of it", () => {
    draw([
      { ...waiting, state: "kept" },
      {
        ...waiting,
        writeId: "write-5",
        number: 4,
        scope: "thesis",
        scopeName: "Thesis",
        state: "discarded",
      },
    ]);

    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
    expect(screen.getByText("Kept")).toBeVisible();
    expect(screen.getByText("Discarded")).toBeVisible();
  });
});
