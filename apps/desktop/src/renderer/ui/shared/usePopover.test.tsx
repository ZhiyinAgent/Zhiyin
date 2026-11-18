import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { focusMenu } from "./menuKeys.js";
import { Menu } from "./Menu.js";
import { usePopover } from "./usePopover.js";

/** A menu as a module builds one, inside something that hears Escape too. */
function Picker({ onOuterEscape }: { onOuterEscape?: () => void }) {
  const { open, toggle, onKeyDown, root, trigger, panel } = usePopover({
    onOpened: focusMenu,
  });
  return (
    <div
      onKeyDown={(event) => {
        if (event.key === "Escape") onOuterEscape?.();
      }}
    >
      <button type="button">Elsewhere</button>
      <div ref={root} onKeyDown={onKeyDown}>
        <button
          type="button"
          ref={trigger}
          aria-expanded={open}
          onClick={() => toggle()}
        >
          Fruit
        </button>
        {open && (
          <Menu ref={panel} label="Fruit" opens="down">
            <button type="button" role="menuitem">
              Apple
            </button>
            <button type="button" role="menuitem">
              Pear
            </button>
          </Menu>
        )}
      </div>
    </div>
  );
}

describe("a popover", () => {
  it("opens with focus on its first item, and moves with the arrow keys", () => {
    render(<Picker />);
    fireEvent.click(screen.getByRole("button", { name: "Fruit" }));

    expect(screen.getByRole("menuitem", { name: "Apple" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Apple" }), {
      key: "ArrowDown",
    });
    expect(screen.getByRole("menuitem", { name: "Pear" })).toHaveFocus();
  });

  it("closes alone on Escape inside it, with focus back on its button", () => {
    const outer = vi.fn();
    render(<Picker onOuterEscape={outer} />);
    const button = screen.getByRole("button", { name: "Fruit" });
    fireEvent.click(button);

    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Apple" }), {
      key: "Escape",
    });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveFocus();
    expect(outer).not.toHaveBeenCalled();
  });

  it("closes on Escape pressed elsewhere too", () => {
    render(<Picker />);
    fireEvent.click(screen.getByRole("button", { name: "Fruit" }));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on a press outside it, leaving focus where the press put it", () => {
    render(<Picker />);
    fireEvent.click(screen.getByRole("button", { name: "Fruit" }));
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });

    fireEvent.pointerDown(elsewhere);
    elsewhere.focus();

    expect(screen.queryByRole("menu")).toBeNull();
    expect(elsewhere).toHaveFocus();
  });

  it("says which way it unrolls", () => {
    render(<Picker />);
    fireEvent.click(screen.getByRole("button", { name: "Fruit" }));

    expect(screen.getByRole("menu")).toHaveAttribute("data-opens", "down");
  });
});
