import { act, render } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "../shared/index.js";
import { useDimmedWindowControls } from "./useDimmedWindowControls.js";

function Page({ dim }: { dim: (dimmed: boolean) => Promise<void> }) {
  useDimmedWindowControls(dim);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <Dialog title="A question" onClose={() => setOpen(false)}>
          <p>Answer it.</p>
        </Dialog>
      )}
    </>
  );
}

describe("Windows' own window controls", () => {
  it("are dimmed while a dialog covers the page, and only then", async () => {
    const dim = vi.fn(async () => {});
    const { getByRole } = render(<Page dim={dim} />);
    await act(async () => {});
    // Said as the page starts, so a page loaded again after one that had a
    // dialog open leaves them lit.
    expect(dim.mock.calls).toEqual([[false]]);

    await act(async () => getByRole("button", { name: "Open" }).click());
    expect(dim).toHaveBeenLastCalledWith(true);

    await act(async () => getByRole("button", { name: /close/i }).click());
    expect(dim.mock.calls).toEqual([[false], [true], [false]]);
  });
});
