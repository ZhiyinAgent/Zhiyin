import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog.js";
import { InfoTip } from "./InfoTip.js";

function connectorsTip(open = vi.fn()) {
  return (
    <InfoTip
      topic="connectors"
      setup={{ open }}
      details="Zhiyin asks before each action a connector takes."
    >
      A connector lets Zhiyin use an online service. Each one is optional.
    </InfoTip>
  );
}

describe("an info button", () => {
  it("is named for what it explains, and says whether its explanation is open", () => {
    render(connectorsTip());
    const button = screen.getByRole("button", { name: "About connectors" });

    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/lets Zhiyin use/)).not.toBeInTheDocument();

    fireEvent.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
    const explanation = document.getElementById(
      button.getAttribute("aria-controls")!,
    );
    expect(explanation).toHaveTextContent(
      "A connector lets Zhiyin use an online service. Each one is optional.",
    );
  });

  it("is reached by Tab and opens from the keyboard, with its link and details next in order", () => {
    render(connectorsTip());
    const button = screen.getByRole("button", { name: "About connectors" });

    button.focus();
    expect(button).toHaveFocus();
    // Focus alone opens nothing: what opened on focus would be gone before
    // its link could be reached.
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);

    const order = [
      ...document.querySelectorAll<HTMLElement>("button, summary"),
    ].map(
      (element) => element.textContent || element.getAttribute("aria-label"),
    );
    expect(order).toEqual(["About connectors", "How to set up", "Details"]);
  });

  it("opens on a touch, and a touch anywhere else closes it", () => {
    render(
      <>
        {connectorsTip()}
        <p>Elsewhere</p>
      </>,
    );
    const button = screen.getByRole("button", { name: "About connectors" });

    fireEvent.pointerDown(button, { pointerType: "touch" });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");

    fireEvent.pointerDown(screen.getByText("Elsewhere"), {
      pointerType: "touch",
    });
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on Escape and gives focus back to its button", () => {
    render(connectorsTip());
    const button = screen.getByRole("button", { name: "About connectors" });
    fireEvent.click(button);
    const link = screen.getByRole("button", { name: "How to set up" });
    link.focus();

    fireEvent.keyDown(link, { key: "Escape" });

    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveFocus();
  });

  it("closes alone on Escape inside a dialog, leaving the dialog open", () => {
    const onClose = vi.fn();
    render(
      <Dialog title="Set up GitHub" onClose={onClose}>
        {connectorsTip()}
      </Dialog>,
    );
    const button = screen.getByRole("button", { name: "About connectors" });
    fireEvent.click(button);

    fireEvent.keyDown(button, { key: "Escape" });

    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("opens the setup page it names, and folds access and how to take it back under Details", () => {
    const open = vi.fn();
    render(connectorsTip(open));
    fireEvent.click(screen.getByRole("button", { name: "About connectors" }));

    fireEvent.click(screen.getByRole("button", { name: "How to set up" }));

    expect(open).toHaveBeenCalledOnce();
    expect(screen.getByText("Details").closest("details")).not.toHaveAttribute(
      "open",
    );
  });

  it("stays inside the smallest window, even from its bottom-right corner", () => {
    Object.assign(window, { innerWidth: 720, innerHeight: 480 });
    render(connectorsTip());
    const button = screen.getByRole("button", { name: "About connectors" });
    button.getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 700, y: 456, width: 16, height: 16 });
    const measure = vi
      .spyOn(HTMLDivElement.prototype, "getBoundingClientRect")
      .mockReturnValue(DOMRect.fromRect({ width: 320, height: 180 }));

    fireEvent.click(button);

    const panel = document.getElementById(
      button.getAttribute("aria-controls")!,
    )!;
    const left = parseFloat(panel.style.left);
    const top = parseFloat(panel.style.top);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + 320).toBeLessThanOrEqual(720 - 8);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top + 180).toBeLessThanOrEqual(456);
    measure.mockRestore();
  });

  it("stays inside the window when opening its details makes it taller", () => {
    Object.assign(window, { innerWidth: 720, innerHeight: 480 });
    let grown: () => void = () => undefined;
    const observe = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(changed: () => void) {
          grown = changed;
        }
        observe = observe;
        disconnect() {}
      },
    );
    render(connectorsTip());
    const button = screen.getByRole("button", { name: "About connectors" });
    button.getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 600, y: 230, width: 16, height: 16 });
    const measure = vi
      .spyOn(HTMLDivElement.prototype, "getBoundingClientRect")
      .mockReturnValue(DOMRect.fromRect({ width: 320, height: 120 }));
    fireEvent.click(button);
    const panel = document.getElementById(
      button.getAttribute("aria-controls")!,
    )!;
    expect(parseFloat(panel.style.top)).toBe(252);

    measure.mockReturnValue(DOMRect.fromRect({ width: 320, height: 300 }));
    grown();

    expect(parseFloat(panel.style.top) + 300).toBeLessThanOrEqual(480 - 8);
    expect(parseFloat(panel.style.top)).toBeGreaterThanOrEqual(8);
    measure.mockRestore();
    vi.unstubAllGlobals();
  });
});
