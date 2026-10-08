import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskView } from "@zhiyin/contract";
import { TaskViewCard } from "./TaskViewCard.js";

/** The drawing the mocked renderer hands back: its width, or a failure. */
const drawing = vi.hoisted(() => ({ width: 100, fails: false }));

vi.mock("./mermaidRuntime.js", () => ({
  renderMermaid: async () => {
    if (drawing.fails) throw new Error("Parse error");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${drawing.width} 40"><text>Draft</text></svg>`;
  },
  diagramGround: () => ({
    background: "#141817",
    ink: { light: "#f4f2ea", dark: "#141817" },
  }),
}));

const diagram: TaskView = {
  sequence: 1,
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
   * The readout is the drawing's real size: 100% is the size it was drawn at,
   * with labels at their full size. Stretched to the width of the frame, a
   * small drawing's labels would be half again as large as anything else in
   * the conversation.
   *
   * That the picture then grows is not visible here, since jsdom lays nothing
   * out; it is seen in a real browser, in the component lab.
   */
  it("drives zoom from the wheel and the buttons as well as the keyboard", async () => {
    render(<TaskViewCard view={diagram} />);
    expect(await screen.findByText("Draft")).toBeVisible();
    const canvas = document.querySelector(".task-view__canvas") as HTMLElement;
    const body = screen.getByRole("region", { name: "Release flow diagram" });
    const drawnWidth = () => canvas.style.getPropertyValue("--drawing-width");

    expect(canvas.className).toContain("task-view__canvas--zoomable");
    expect(screen.getByText("100%")).toBeVisible();
    expect(drawnWidth()).toBe("100px");

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("110%")).toBeVisible();
    expect(drawnWidth()).toBe("110px");

    fireEvent.wheel(body, { deltaY: -1 });
    expect(screen.getByText("120%")).toBeVisible();
    expect(drawnWidth()).toBe("120px");

    fireEvent.wheel(body, { deltaY: 1 });
    expect(screen.getByText("110%")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    expect(screen.getByText("100%")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByText("90%")).toBeVisible();
    expect(drawnWidth()).toBe("90px");
  });

  it("zooms out to a quarter and no further", async () => {
    render(<TaskViewCard view={diagram} />);
    expect(await screen.findByText("Draft")).toBeVisible();

    for (let click = 0; click < 12; click += 1)
      fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));

    expect(screen.getByText("25%")).toBeVisible();
  });

  describe("in a frame 640px wide", () => {
    const frameWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientWidth",
    );
    beforeEach(() => {
      Object.defineProperty(HTMLElement.prototype, "clientWidth", {
        configurable: true,
        get(this: HTMLElement) {
          return this.getAttribute("role") === "region" ? 640 : 0;
        },
      });
    });
    afterEach(() => {
      if (frameWidth)
        Object.defineProperty(HTMLElement.prototype, "clientWidth", frameWidth);
      drawing.width = 100;
    });

    it("shows a small drawing at its own size, with nothing to drag", async () => {
      render(<TaskViewCard view={diagram} />);
      expect(await screen.findByText("Draft")).toBeVisible();

      expect(screen.getByText("100%")).toBeVisible();
      expect(screen.getByRole("button", { name: "Fit" })).toBeDisabled();
      expect(screen.queryByText("Drag to move around")).toBeNull();
    });

    /**
     * Fitted, a long drawing's labels would be a few pixels tall: legible as a
     * shape and not as words. It opens at a size its labels can be read at,
     * says it can be dragged, and still fits whole on request.
     */
    it("opens a long drawing at a readable size and fits it whole on request", async () => {
      drawing.width = 2000;
      render(<TaskViewCard view={diagram} />);
      expect(await screen.findByText("Draft")).toBeVisible();

      expect(screen.getByText("75%")).toBeVisible();
      expect(screen.getByText("Drag to move around")).toBeVisible();

      fireEvent.click(screen.getByRole("button", { name: "Fit" }));

      expect(screen.getByText("30%")).toBeVisible();
      expect(screen.queryByText("Drag to move around")).toBeNull();
      expect(screen.getByRole("button", { name: "Fit" })).toBeDisabled();

      fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
      expect(screen.getByText("40%")).toBeVisible();
    });
  });

  it("offers no zoom for a diagram that could not be drawn", async () => {
    drawing.fails = true;
    try {
      render(<TaskViewCard view={diagram} />);
      expect(await screen.findByRole("alert")).toBeVisible();

      expect(screen.queryByRole("button", { name: "Zoom in" })).toBeNull();
      expect(screen.getByRole("tab", { name: "Source" })).toBeVisible();
    } finally {
      drawing.fails = false;
    }
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
   * that as focus-visible, which would draw the ring meant for keyboard
   * navigation around a diagram somebody has only taken hold of. The ring
   * still has to appear for whoever is navigating by keyboard, so it is
   * suppressed by how focus arrived rather than removed.
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
          sequence: 1,
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
          sequence: 1,
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
      screen.getByRole("table", { name: `${data.title} data` }),
    ).toBeVisible();

    fireEvent.click(screen.getByText("Technical"));
    expect(
      screen.getByText(
        (content, element) =>
          element?.tagName === "CODE" && content.includes(data.title),
      ),
    ).toBeVisible();
  });

  it("lists a chart's values as a table, named by its axes", () => {
    render(
      <TaskViewCard
        view={{
          sequence: 1,
          id: "table",
          callId: "table",
          kind: "bar-chart",
          title: "Requests by channel",
          source: JSON.stringify({
            kind: "bar-chart",
            title: "Requests by channel",
            xLabel: "Channel",
            yLabel: "Requests",
            categories: [
              { label: "Email", value: 42 },
              { label: "Chat", value: 17 },
            ],
          }),
        }}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    const table = screen.getByRole("table", {
      name: "Requests by channel data",
    });

    expect(
      [...table.querySelectorAll("tr")].map((row) =>
        [...row.children].map((cell) => cell.textContent),
      ),
    ).toEqual([
      ["Channel", "Requests"],
      ["Email", "42"],
      ["Chat", "17"],
    ]);
  });

  it("puts a histogram's unit on the axis its values run along, and marks the bin edges", () => {
    render(
      <TaskViewCard
        view={{
          sequence: 1,
          id: "durations",
          callId: "durations",
          kind: "histogram",
          title: "Turn duration",
          source: JSON.stringify({
            kind: "histogram",
            title: "Turn duration",
            xLabel: "Duration",
            unit: "s",
            bins: 2,
            values: [8, 9, 10, 12],
          }),
        }}
      />,
    );
    const drawn = [
      ...screen
        .getByRole("img", { name: "Turn duration" })
        .querySelectorAll("text"),
    ].map((label) => label.textContent);

    expect(drawn).toContain("Duration (s)");
    expect(drawn).toContain("Count");
    expect(drawn).not.toContain("Count (s)");
    expect(drawn).toEqual(expect.arrayContaining(["8", "10", "12"]));
  });

  it.each([
    [
      "an empty histogram",
      { kind: "histogram", title: "Empty data", values: [] },
      "There is no data to chart.",
    ],
    [
      "a line chart with more lines than it can draw",
      {
        kind: "line-chart",
        title: "Too many series",
        series: Array.from({ length: 12 }, (_, index) => ({
          name: `S${index}`,
          points: [{ x: 1, y: index }],
        })),
      },
      "This chart has too many lines to draw (12 of 8 allowed).",
    ],
  ] as const)(
    "says what is wrong with %s, and keeps its title and data",
    (_, data, reason) => {
      render(
        <TaskViewCard
          view={{
            sequence: 1,
            id: "failed",
            callId: "failed",
            kind: data.kind,
            title: data.title,
            source: JSON.stringify(data),
          }}
        />,
      );

      expect(screen.getByRole("alert")).toHaveTextContent(reason);
      expect(screen.getByRole("heading", { name: data.title })).toBeVisible();
      fireEvent.click(screen.getByRole("tab", { name: "Data" }));
      expect(screen.getByText(/"kind"/)).toBeVisible();
    },
  );

  /**
   * A chart has no zoom, and nothing to report until it is saved. A footer
   * drawn anyway would be a ruled-off bar of nothing under every chart.
   */
  it("ends a chart at the chart, with no empty bar beneath it", () => {
    const { container } = render(
      <TaskViewCard
        view={{
          sequence: 1,
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
          sequence: 1,
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
          sequence: 1,
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
          sequence: 1,
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
          sequence: 1,
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
          sequence: 1,
          id: "bad",
          callId: "bad",
          kind: "bar-chart",
          title: "Broken",
          source: "{",
        }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The chart data could not be read.",
    );
  });

  it("says a kind of view it cannot draw is unknown, rather than drawing another kind", () => {
    const source = JSON.stringify({
      kind: "pie-chart",
      title: "Share",
      slices: [{ label: "A", value: 1 }],
    });
    render(
      <TaskViewCard
        view={
          {
            id: "unknown",
            callId: "unknown",
            kind: "pie-chart",
            title: "Share",
            source,
          } as unknown as TaskView
        }
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "can't be shown in this version of Zhiyin",
    );
    expect(document.querySelector("svg")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    expect(screen.getByText(/slices/)).toBeVisible();
  });
});
