import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SurfaceFrame } from "./SurfaceFrame.js";

function frame(onPick: (id: string) => void) {
  return render(
    <div>
      <button type="button">Elsewhere</button>
      <SurfaceFrame
        label="Document"
        title="report.pdf"
        menu={{
          label: "Documents",
          listLabel: "This conversation's documents",
          items: [
            { id: "report", name: "report.pdf" },
            { id: "notes", name: "notes.pdf", detail: "docs" },
          ],
          current: "report",
          onPick,
        }}
      >
        <p>The page.</p>
      </SurfaceFrame>
    </div>,
  );
}

describe("the menu of what a surface shows", () => {
  it("shows another item when it is picked, and closes", () => {
    const onPick = vi.fn();
    frame(onPick);

    fireEvent.click(screen.getByRole("button", { name: "Documents" }));
    fireEvent.click(screen.getByRole("button", { name: /notes\.pdf/ }));

    expect(onPick).toHaveBeenCalledWith("notes");
    expect(
      screen.queryByRole("list", { name: "This conversation's documents" }),
    ).toBeNull();
  });

  it("asks for nothing when the item already shown is picked", () => {
    const onPick = vi.fn();
    frame(onPick);

    fireEvent.click(screen.getByRole("button", { name: "Documents" }));
    fireEvent.click(screen.getByRole("button", { name: "report.pdf" }));

    expect(onPick).not.toHaveBeenCalled();
  });

  it("closes on Escape, with focus back on its button", () => {
    frame(() => {});
    const button = screen.getByRole("button", { name: "Documents" });

    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(screen.getByRole("button", { name: /notes\.pdf/ }), {
      key: "Escape",
    });

    expect(
      screen.queryByRole("list", { name: "This conversation's documents" }),
    ).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("closes on a press outside it", () => {
    frame(() => {});

    fireEvent.click(screen.getByRole("button", { name: "Documents" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));

    expect(
      screen.queryByRole("list", { name: "This conversation's documents" }),
    ).toBeNull();
  });
});
