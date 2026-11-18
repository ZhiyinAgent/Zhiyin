/**
 * The sidebar's width is the person's to set: dragged or keyed, kept inside
 * a range, and still there at the next start.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { NavigationDrawer } from "./NavigationDrawer.js";
import { sidebarWidthRange } from "./sidebarWidth.js";

function drawer() {
  return render(
    <NavigationDrawer
      open={false}
      onOpenChange={() => undefined}
      sidebar={({ ref }) => <aside ref={ref}>Sidebar</aside>}
    >
      <main>Page</main>
    </NavigationDrawer>,
  );
}

const edge = () => screen.getByRole("separator", { name: "Sidebar width" });
const shellWidth = (view: ReturnType<typeof drawer>) =>
  (view.container.firstElementChild as HTMLElement).style.getPropertyValue(
    "--zy-sidebar-width",
  );

describe("the sidebar's width", () => {
  beforeEach(() => window.localStorage.clear());

  it("opens at its default until the person changes it", () => {
    const view = drawer();

    expect(shellWidth(view)).toBe("");
  });

  it("grows and shrinks with the arrow keys, and stops at the ends of its range", () => {
    const view = drawer();

    fireEvent.keyDown(edge(), { key: "End" });
    expect(shellWidth(view)).toBe(`${sidebarWidthRange.max}px`);

    fireEvent.keyDown(edge(), { key: "ArrowRight" });
    expect(shellWidth(view)).toBe(`${sidebarWidthRange.max}px`);

    fireEvent.keyDown(edge(), { key: "ArrowLeft" });
    expect(shellWidth(view)).toBe(`${sidebarWidthRange.max - 16}px`);

    fireEvent.keyDown(edge(), { key: "Home" });
    expect(shellWidth(view)).toBe(`${sidebarWidthRange.min}px`);

    fireEvent.keyDown(edge(), { key: "ArrowLeft" });
    expect(shellWidth(view)).toBe(`${sidebarWidthRange.min}px`);
  });

  it("is the width it was left at when the window opens again", () => {
    const first = drawer();
    fireEvent.keyDown(edge(), { key: "End" });
    first.unmount();

    const second = drawer();

    expect(shellWidth(second)).toBe(`${sidebarWidthRange.max}px`);
  });

  it("ignores a saved width that is not a number, or is out of range", () => {
    window.localStorage.setItem("zhiyin.sidebar-width", "wide");
    expect(shellWidth(drawer())).toBe("");

    window.localStorage.setItem("zhiyin.sidebar-width", "9000");
    expect(shellWidth(drawer())).toBe(`${sidebarWidthRange.max}px`);
  });
});
