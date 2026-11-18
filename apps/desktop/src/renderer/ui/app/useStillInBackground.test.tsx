import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useStillInBackground } from "./useStillInBackground.js";

function Window() {
  useStillInBackground();
  return null;
}

const away = () => document.documentElement.hasAttribute("data-window-away");

describe("the ground's slow motion", () => {
  it("holds still while the window is in the background, and moves again in front", () => {
    const { unmount } = render(<Window />);

    act(() => void window.dispatchEvent(new Event("blur")));
    expect(away()).toBe(true);

    act(() => void window.dispatchEvent(new Event("focus")));
    expect(away()).toBe(false);

    act(() => void window.dispatchEvent(new Event("blur")));
    unmount();
    expect(away()).toBe(false);
  });
});
