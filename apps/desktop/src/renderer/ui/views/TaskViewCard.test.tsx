import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskView } from "@zhiyin/contract";
import { TaskViewCard } from "./TaskViewCard.js";

vi.mock("./mermaidRuntime.js", () => ({
  renderMermaid: async () =>
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text>Draft</text></svg>',
  diagramBackground: "#141817",
  diagramInk: { light: "#f4f2ea", dark: "#141817" },
}));

const diagram: TaskView = {
  id: "view-1",
  callId: "call-1",
  kind: "diagram",
  title: "Release flow",
  source: "flowchart LR\nDraft --> Review",
};

describe("TaskViewCard", () => {
  it("shows a validated diagram with source, keyboard zoom, and explicit save", async () => {
    const onSave = vi.fn(async () => ({
      status: "saved" as const,
      destination: "flow.svg",
    }));
    render(<TaskViewCard view={diagram} onSave={onSave} />);
    expect(await screen.findByText("Draft")).toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "Source" }));
    expect(screen.getByText(/flowchart LR/)).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Rendered" }));
    fireEvent.keyDown(
      screen.getByRole("region", { name: "Release flow diagram" }),
      { key: "+" },
    );
    expect(screen.getByText("110%")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Save image" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(expect.stringContaining("<svg")),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
  });

  /**
   * The zoom controls used to change a number and nothing else: the canvas
   * widened, and the drawing inside stayed put because it was already at the
   * width and height caps it is given at rest. Those caps are lifted by the
   * zoomable class, which is what this checks reaches the drawing — along with
   * all three ways of asking for a change.
   *
   * That the picture then actually grows is not something this test can see.
   * It was measured in a real browser: 592px wide at 100%, 908px at 150%, with
   * the frame gaining a horizontal scrollbar.
   */
  it("drives zoom from the wheel and the buttons as well as the keyboard", async () => {
    render(<TaskViewCard view={diagram} />);
    expect(await screen.findByText("Draft")).toBeVisible();
    const canvas = document.querySelector(".task-view__canvas") as HTMLElement;
    const body = screen.getByRole("region", { name: "Release flow diagram" });

    expect(canvas.className).toContain("task-view__canvas--zoomable");
    expect(canvas).toHaveStyle({ width: "100%" });

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("110%")).toBeVisible();
    expect(canvas).toHaveStyle({ width: "110%" });

    fireEvent.wheel(body, { deltaY: -1 });
    expect(screen.getByText("120%")).toBeVisible();
    expect(canvas).toHaveStyle({ width: "120%" });

    fireEvent.wheel(body, { deltaY: 1 });
    expect(screen.getByText("110%")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    expect(screen.getByText("100%")).toBeVisible();
    expect(canvas).toHaveStyle({ width: "100%" });

    // Below the resting size as well as above it. Zooming out did nothing for
    // the same reason zooming in did: a floor under the width, this one
    // holding the canvas at the frame's own size.
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByText("90%")).toBeVisible();
    expect(canvas).toHaveStyle({ width: "90%" });
  });

  it("zooms out to a quarter and no further", async () => {
    render(<TaskViewCard view={diagram} />);
    expect(await screen.findByText("Draft")).toBeVisible();
    const canvas = document.querySelector(".task-view__canvas") as HTMLElement;

    for (let click = 0; click < 12; click += 1)
      fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));

    expect(screen.getByText("25%")).toBeVisible();
    expect(canvas).toHaveStyle({ width: "25%" });
  });

  it("pans a diagram without starting browser text selection", async () => {
    render(<TaskViewCard view={diagram} />);
    expect(await screen.findByText("Draft")).toBeVisible();
    const body = screen.getByRole("region", { name: "Release flow diagram" });
    const pointerDown = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      clientX: 20,
      clientY: 30,
    });

    body.dispatchEvent(pointerDown);

    expect(pointerDown.defaultPrevented).toBe(true);
    expect(body).toHaveFocus();

    fireEvent.click(screen.getByRole("tab", { name: "Source" }));
    const sourcePointerDown = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
    });
    body.dispatchEvent(sourcePointerDown);

    expect(sourcePointerDown.defaultPrevented).toBe(false);
  });

  /**
   * Grabbing a drawing to drag it focuses the region, and the browser reports
   * that as focus-visible — so the ring meant for keyboard navigation was
   * being drawn around a diagram somebody had simply taken hold of. The ring
   * still has to appear for whoever is actually navigating by keyboard, so it
   * is suppressed by how focus arrived rather than removed.
   */
  it("marks a grabbed diagram as pointer-focused, and unmarks it at the first key", async () => {
    render(<TaskViewCard view={diagram} />);
    expect(await screen.findByText("Draft")).toBeVisible();
    const body = screen.getByRole("region", { name: "Release flow diagram" });

    body.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 30,
      }),
    );

    expect(body).toHaveFocus();
    expect(body).toHaveAttribute("data-pointer-focus");

    fireEvent.keyDown(body, { key: "ArrowRight" });

    expect(body).not.toHaveAttribute("data-pointer-focus");
  });

  it("forgets a pointer grab once focus leaves, so tabbing back shows focus", async () => {
    render(<TaskViewCard view={diagram} />);
    expect(await screen.findByText("Draft")).toBeVisible();
    const body = screen.getByRole("region", { name: "Release flow diagram" });

    body.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    expect(body).toHaveAttribute("data-pointer-focus");

    fireEvent.blur(body);

    expect(body).not.toHaveAttribute("data-pointer-focus");
  });

  it("does not offer zoom controls on a view that is not zoomable", () => {
    render(
      <TaskViewCard
        view={{
          id: "bars",
          callId: "bars",
          kind: "bar-chart",
          title: "Bars",
          source: JSON.stringify({
            kind: "bar-chart",
            title: "Bars",
            categories: [{ label: "A", value: 2 }],
          }),
        }}
      />,
    );

    expect(screen.queryByRole("button", { name: "Zoom in" })).toBeNull();
  });

  it.each([
    [
      "bar-chart",
      {
        kind: "bar-chart",
        title: "Bars",
        categories: [{ label: "A", value: 2 }],
      },
    ],
    [
      "line-chart",
      {
        kind: "line-chart",
        title: "Lines",
        series: [{ name: "Actual", points: [{ x: "Jan", y: 2 }] }],
      },
    ],
    [
      "scatter-plot",
      {
        kind: "scatter-plot",
        title: "Scatter",
        series: [{ name: "Trials", points: [{ x: 1, y: 2 }] }],
      },
    ],
    ["histogram", { kind: "histogram", title: "Histogram", values: [1, 2, 3] }],
    [
      "box-plot",
      {
        kind: "box-plot",
        title: "Boxes",
        groups: [{ label: "A", values: [1, 2, 3] }],
      },
    ],
  ] as const)("renders %s with its underlying data available", (kind, data) => {
    render(
      <TaskViewCard
        view={{
          id: kind,
          callId: kind,
          kind,
          title: data.title,
          source: JSON.stringify(data),
        }}
      />,
    );
    expect(screen.getByRole("img", { name: data.title })).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    expect(
      screen.getByText(
        (content, element) =>
          element?.tagName === "CODE" && content.includes(data.title),
      ),
    ).toBeVisible();
  });

  /**
   * A chart has no zoom, and nothing to report until it is saved. The footer
   * was drawn anyway: a ruled-off bar of nothing under every chart.
   */
  it("ends a chart at the chart, with no empty bar beneath it", () => {
    const { container } = render(
      <TaskViewCard
        view={{
          id: "bars",
          callId: "bars",
          kind: "bar-chart",
          title: "Requests",
          source: JSON.stringify({
            kind: "bar-chart",
            title: "Requests",
            categories: [{ label: "A", value: 2 }],
          }),
        }}
      />,
    );

    expect(container.querySelector(".task-view__footer")).toBeNull();
  });

  it("still has somewhere to report a save", async () => {
    const onSave = vi.fn(async () => ({
      status: "saved" as const,
      destination: "bars.svg",
    }));
    const { container } = render(
      <TaskViewCard
        view={{
          id: "bars",
          callId: "bars",
          kind: "bar-chart",
          title: "Requests",
          source: JSON.stringify({
            kind: "bar-chart",
            title: "Requests",
            categories: [{ label: "A", value: 2 }],
          }),
        }}
        onSave={onSave}
      />,
    );
    expect(container.querySelector(".task-view__footer")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save image" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
    expect(container.querySelector(".task-view__footer")).not.toBeNull();
  });

  it("puts a readable scale on the value axis, so a chart can be read as well as seen", () => {
    render(
      <TaskViewCard
        view={{
          id: "scaled",
          callId: "scaled",
          kind: "bar-chart",
          title: "Requests",
          source: JSON.stringify({
            kind: "bar-chart",
            title: "Requests",
            yLabel: "Requests",
            unit: "ms",
            categories: [
              { label: "A", value: 40 },
              { label: "B", value: 10 },
            ],
          }),
        }}
      />,
    );
    const chart = screen.getByRole("img", { name: "Requests" });
    const drawn = [...chart.querySelectorAll("text")].map(
      (label) => label.textContent,
    );
    expect(drawn).toContain("40");
    expect(drawn).toContain("0");
  });

  it("names where a plotted axis starts and ends, rather than implying it", () => {
    render(
      <TaskViewCard
        view={{
          id: "spanned",
          callId: "spanned",
          kind: "line-chart",
          title: "Response time",
          source: JSON.stringify({
            kind: "line-chart",
            title: "Response time",
            series: [
              {
                name: "Current",
                points: [
                  { x: "Week 1", y: 480 },
                  { x: "Week 2", y: 420 },
                  { x: "Week 3", y: 310 },
                ],
              },
            ],
          }),
        }}
      />,
    );
    const chart = screen.getByRole("img", { name: "Response time" });
    const drawn = [...chart.querySelectorAll("text")].map(
      (label) => label.textContent,
    );
    expect(drawn).toContain("Week 1");
    expect(drawn).toContain("Week 3");
  });

  it("saves a chart that still stands up outside the app that drew it", async () => {
    const style = document.createElement("style");
    style.textContent =
      ".task-chart__axis { stroke: rgb(1, 2, 3); } .task-chart__tick { fill: rgb(4, 5, 6); }";
    document.head.append(style);
    const onSave = vi.fn<
      (svg: string) => Promise<{ status: "saved"; destination: string }>
    >(async () => ({ status: "saved", destination: "bars.svg" }));
    render(
      <TaskViewCard
        view={{
          id: "saved",
          callId: "saved",
          kind: "bar-chart",
          title: "Requests",
          source: JSON.stringify({
            kind: "bar-chart",
            title: "Requests",
            categories: [{ label: "A", value: 2 }],
          }),
        }}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save image" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0]![0];
    style.remove();

    expect(saved).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(saved).toContain("rgb(1, 2, 3)");
    expect(saved).toContain("rgb(4, 5, 6)");
  });

  it("keeps a corrupt restored view contained in a readable failure state", () => {
    render(
      <TaskViewCard
        view={{
          id: "bad",
          callId: "bad",
          kind: "bar-chart",
          title: "Broken",
          source: "{",
        }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("could not be drawn");
  });
});
