import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskViewCard } from "./TaskViewCard.js";

/**
 * A drawing as Mermaid writes one whose author set a label's colour: its own
 * stylesheet paints the label white, as an important rule. The label in the
 * window has been repainted dark, as the contrast pass does, also important.
 */
vi.mock("./mermaidRuntime.js", () => ({
  renderMermaid: async () =>
    [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40">',
      "<style>.note tspan { fill: #ffffff !important; }</style>",
      '<g class="note"><text><tspan style="fill: rgb(24, 25, 27) !important">Note</tspan></text></g>',
      "</svg>",
    ].join(""),
  diagramGround: () => ({
    background: "#ffffff",
    ink: { light: "#f4f2ea", dark: "#18191b" },
  }),
}));

describe("a saved diagram", () => {
  it("keeps the colours the window shows, over the drawing's own important rules", async () => {
    const onSave = vi.fn<
      (svg: string) => Promise<{ status: "saved"; destination: string }>
    >(async () => ({ status: "saved", destination: "note.svg" }));
    render(
      <TaskViewCard
        view={{
          sequence: 1,
          id: "note",
          callId: "note",
          kind: "diagram",
          title: "Note",
          source: "flowchart LR\nA --> B",
        }}
        onSave={onSave}
      />,
    );
    expect(await screen.findByText("Note")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Save image" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = new DOMParser().parseFromString(
      onSave.mock.calls[0]![0],
      "image/svg+xml",
    );
    const label = saved.querySelector("tspan") as unknown as SVGElement;

    // Outside the app, the drawing's own important rule loses to this one.
    expect(label.style.getPropertyValue("fill")).toBe("rgb(24, 25, 27)");
    expect(label.style.getPropertyPriority("fill")).toBe("important");
  });
});
