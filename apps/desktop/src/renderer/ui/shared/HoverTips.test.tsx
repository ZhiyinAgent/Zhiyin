import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoverTips } from "./HoverTips.js";

function page() {
  render(
    <>
      <HoverTips />
      <button type="button" aria-label="Open navigation">
        <svg />
      </button>
      <button type="button">Save</button>
      <button type="button" disabled data-tip="Paste a key first">
        Save key
      </button>
      <button type="button" aria-label="Close" title="Close this panel">
        <svg />
      </button>
    </>,
  );
}

function hover(element: Element) {
  fireEvent.pointerOver(element);
  act(() => {
    vi.advanceTimersByTime(600);
  });
}

describe("labels on hover and focus", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("names a control drawn as an icon alone when the pointer rests on it", () => {
    page();

    hover(screen.getByRole("button", { name: "Open navigation" }));

    expect(screen.getByRole("tooltip")).toHaveTextContent("Open navigation");
  });

  it("names it at once when it is reached with the keyboard", () => {
    page();
    const button = screen.getByRole("button", { name: "Open navigation" });

    fireEvent.keyDown(document.body, { key: "Tab" });
    fireEvent.focusIn(button);

    expect(screen.getByRole("tooltip")).toHaveTextContent("Open navigation");
  });

  it("says nothing over a control that already shows its words", () => {
    page();

    hover(screen.getByRole("button", { name: "Save" }));

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("says what is missing over a control that cannot be used yet", () => {
    page();

    hover(screen.getByRole("button", { name: "Save key" }));

    expect(screen.getByRole("tooltip")).toHaveTextContent("Paste a key first");
  });

  it("leaves a control with its own tooltip to it, so two never show", () => {
    page();

    hover(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("goes when the pointer leaves, and on Escape", () => {
    page();
    const button = screen.getByRole("button", { name: "Open navigation" });

    hover(button);
    fireEvent.pointerOut(button);
    expect(screen.queryByRole("tooltip")).toBeNull();

    hover(button);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
