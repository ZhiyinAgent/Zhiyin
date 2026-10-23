import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "../shared/index.js";
import { ArtifactDrawer } from "./ArtifactDrawer.js";

function drawer(open: boolean, onClose: () => void) {
  return (
    <ArtifactDrawer
      conversationId="task-1"
      artifacts={[]}
      open={open}
      onClose={onClose}
      onPreview={vi.fn()}
      onExport={vi.fn()}
    />
  );
}

describe("the Files drawer", () => {
  it("keeps focus where the person put it while the window draws again", () => {
    // A new function each time, as the shell draws it.
    const { rerender } = render(drawer(true, () => undefined));
    const close = screen.getByRole("button", { name: "Close" });
    close.focus();

    rerender(drawer(true, () => undefined));
    rerender(drawer(true, () => undefined));

    expect(document.activeElement).toBe(close);
  });

  it("leaves Escape to a dialog open over it", () => {
    const closeDrawer = vi.fn();
    const closeDialog = vi.fn();
    render(
      <>
        {drawer(true, closeDrawer)}
        <Dialog title="Running commands" onClose={closeDialog}>
          <p>One command is running.</p>
        </Dialog>
      </>,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(closeDialog).toHaveBeenCalledTimes(1);
    expect(closeDrawer).not.toHaveBeenCalled();
  });

  it("closes on Escape, giving focus back to what opened it", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    const { rerender } = render(drawer(true, onClose));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(drawer(false, onClose));

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
