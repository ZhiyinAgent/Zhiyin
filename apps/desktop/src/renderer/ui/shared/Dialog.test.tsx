import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog.js";

describe("Dialog", () => {
  it("closes when the person clicks outside it, and not inside it", () => {
    const onClose = vi.fn();
    render(
      <Dialog title="API key" onClose={onClose}>
        <p>Body</p>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "API key" });

    fireEvent.pointerDown(screen.getByText("Body"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes only the dialog on top when one opens over another", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <Dialog title="Outer" onClose={outer}>
        <Dialog title="Inner" onClose={inner}>
          <p>Inner body</p>
        </Dialog>
      </Dialog>,
    );

    fireEvent.pointerDown(screen.getByText("Inner body"));
    expect(inner).not.toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(inner).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
  });

  it("stays open when the window loses focus, so a key can be copied from elsewhere", () => {
    const onClose = vi.fn();
    render(
      <Dialog title="API key" onClose={onClose}>
        <p>Body</p>
      </Dialog>,
    );

    fireEvent.blur(window);

    expect(onClose).not.toHaveBeenCalled();
  });
});
