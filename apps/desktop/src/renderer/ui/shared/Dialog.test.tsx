import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog.js";

describe("Dialog", () => {
  it("opens over the whole window, not inside what opened it", () => {
    const { container } = render(
      <Dialog title="Picture" onClose={() => undefined}>
        <p>Body</p>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog", { name: "Picture" });
    expect(container.contains(dialog)).toBe(false);
  });

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

  /**
   * Chromium lets the keyboard reach a body that scrolls, as it does at the
   * smallest window, though it is no control. Tab from there goes on to what
   * follows it, not back to the top.
   */
  it("moves on from a focused part of the body that is no control, in the order the dialog shows", () => {
    render(
      <Dialog
        title="Install Python"
        onClose={() => undefined}
        footer={
          <>
            <button type="button">Install</button>
            <button type="button">Not now</button>
          </>
        }
      >
        <p tabIndex={-1}>What will be installed</p>
      </Dialog>,
    );
    const body = screen.getByText("What will be installed");

    body.focus();
    fireEvent.keyDown(body, { key: "Tab" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Install" }),
    );

    body.focus();
    fireEvent.keyDown(body, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close" }),
    );
  });

  it("closes only the dialog on top with Escape when one opens over another", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    const { rerender } = render(
      <Dialog title="Outer" onClose={outer}>
        <p>Outer body</p>
      </Dialog>,
    );
    rerender(
      <Dialog title="Outer" onClose={outer}>
        <p>Outer body</p>
        <Dialog title="Inner" onClose={inner}>
          <p>Inner body</p>
        </Dialog>
      </Dialog>,
    );

    fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });

    expect(inner).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
  });
});
