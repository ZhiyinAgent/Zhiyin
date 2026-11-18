import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LookSwitcher } from "./LookSwitcher.js";

const root = document.documentElement;

afterEach(() => {
  root.removeAttribute("data-look");
  root.removeAttribute("data-look-strength");
  window.history.replaceState(null, "", "/");
});

describe("the lab's look switcher", () => {
  it("dresses the page in each listed look and strength, and keeps the choice in the address", () => {
    window.history.replaceState(null, "", "/?look=neutral");
    render(<LookSwitcher />);

    expect(screen.getByRole("radio", { name: "Neutral" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Ink" }));
    fireEvent.click(screen.getByRole("radio", { name: "Vivid" }));

    expect(root).toHaveAttribute("data-look", "ink");
    expect(root).toHaveAttribute("data-look-strength", "vivid");
    expect(window.location.search).toBe("?look=ink&strength=vivid");
  });
});
