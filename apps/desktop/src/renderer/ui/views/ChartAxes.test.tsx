import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TaskViewCard } from "./TaskViewCard.js";
import { timeOf } from "./chartAxes.js";

const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function chart(data: Record<string, unknown>) {
  const { container } = render(
    <TaskViewCard
      view={{
        sequence: 1,
        id: "chart",
        callId: "chart",
        kind: data["kind"] as "line-chart",
        title: String(data["title"]),
        source: JSON.stringify(data),
      }}
    />,
  );
  const svg = container.querySelector("svg")!;
  const [, horizontal] = [...svg.querySelectorAll("line")].filter((line) =>
    line.getAttribute("class")?.includes("task-chart__axis"),
  );
  const plot = {
    left: Number(horizontal!.getAttribute("x1")),
    right: Number(horizontal!.getAttribute("x2")),
  };
  /** Each mark's title and where it is drawn. */
  const marks = [...svg.querySelectorAll("circle, rect")]
    .filter((mark) => mark.querySelector("title"))
    .map((mark) => ({
      title: mark.querySelector("title")!.textContent ?? "",
      x: Number(mark.getAttribute("cx") ?? mark.getAttribute("x")),
      y: Number(mark.getAttribute("cy") ?? mark.getAttribute("y")),
      height: Number(mark.getAttribute("height") ?? 0),
    }));
  const at = (title: string) => {
    const mark = marks.find((each) => each.title.startsWith(title));
    if (!mark) throw new Error(`No mark titled ${title}`);
    return mark;
  };
  const ticks = [...svg.querySelectorAll("text")]
    .filter((text) => text.getAttribute("class")?.includes("task-chart__tick"))
    .map((text) => text.textContent ?? "");
  /** The value axis's labels, beside it on the left. */
  const valueTicks = [...svg.querySelectorAll("text")]
    .filter(
      (text) =>
        text.getAttribute("class")?.includes("task-chart__tick") &&
        Number(text.getAttribute("x")) < plot.left,
    )
    .map((text) => text.textContent ?? "");
  return { svg, plot, marks, at, ticks, valueTicks };
}

function dataRows(): string[][] {
  fireEvent.click(screen.getByRole("tab", { name: "Data" }));
  return [...screen.getByRole("table").querySelectorAll("tbody tr")].map(
    (row) => [...row.children].map((cell) => cell.textContent ?? ""),
  );
}

describe("a line chart's x axis", () => {
  it("places each point at its x, shared by every series, whatever the series' lengths", () => {
    const { at, ticks } = chart({
      kind: "line-chart",
      title: "This year against last",
      series: [
        {
          name: "2025",
          points: months.map((x, index) => ({ x, y: 10 + index })),
        },
        {
          name: "2026",
          points: months.slice(0, 9).map((x, index) => ({ x, y: 20 + index })),
        },
      ],
    });

    expect(at("2026, Sep").x).toBe(at("2025, Sep").x);
    expect(at("2026, Sep").x).toBeLessThan(at("2025, Dec").x);
    expect(ticks).toContain("Jan");
    expect(ticks).toContain("Dec");
  });

  it("places a series that starts later at its own x, not at the start of the axis", () => {
    const { at } = chart({
      kind: "line-chart",
      title: "Second half",
      series: [
        { name: "Year", points: months.map((x, y) => ({ x, y })) },
        {
          name: "Half",
          points: months.slice(6).map((x, y) => ({ x, y: y + 20 })),
        },
      ],
    });

    expect(at("Half, Jul").x).toBe(at("Year, Jul").x);
    expect(at("Half, Dec").x).toBe(at("Year, Dec").x);
  });

  it("spaces numbers on the x axis by their value", () => {
    const { at } = chart({
      kind: "line-chart",
      title: "Uneven steps",
      series: [
        {
          name: "Load",
          points: [
            { x: 1, y: 3 },
            { x: 2, y: 4 },
            { x: 10, y: 5 },
          ],
        },
      ],
    });

    const one = at("Load, 1:").x;
    const two = at("Load, 2:").x;
    const ten = at("Load, 10:").x;
    expect(two - one).toBeLessThan((ten - one) / 4);
  });

  it("spaces dates on the x axis by time, and joins each series across the dates another fills in", () => {
    const { at, svg, ticks } = chart({
      kind: "line-chart",
      title: "Signups",
      series: [
        {
          name: "Daily",
          points: [
            { x: "2026-01-01", y: 3 },
            { x: "2026-01-02", y: 4 },
            { x: "2026-02-01", y: 5 },
          ],
        },
        {
          name: "Monthly",
          // Given out of order, as a model may.
          points: [
            { x: "2026-02-01", y: 9 },
            { x: "2026-01-01", y: 8 },
          ],
        },
      ],
    });

    const first = at("Daily, 2026-01-01").x;
    const second = at("Daily, 2026-01-02").x;
    const month = at("Daily, 2026-02-01").x;
    expect(second - first).toBeLessThan((month - first) / 4);
    expect(at("Monthly, 2026-02-01").x).toBe(month);
    expect(at("Monthly, 2026-01-01").x).toBe(first);
    // Each series is one line, the monthly one included, drawn from the
    // earliest date to the latest.
    const lines = [...svg.querySelectorAll("polyline")].map((line) =>
      (line.getAttribute("points") ?? "")
        .split(" ")
        .map((pair) => Number(pair.split(",")[0])),
    );
    expect(lines).toHaveLength(2);
    for (const xs of lines) expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(ticks).toContain("2026-01-01");
    expect(ticks).toContain("2026-02-01");
  });

  it("places dates with a time of day by that time", () => {
    const { at } = chart({
      kind: "line-chart",
      title: "Load",
      series: [
        {
          name: "Load",
          points: [
            { x: "2026-10-20T00:00:00Z", y: 1 },
            { x: "2026-10-20T06:00:00Z", y: 2 },
            { x: "2026-10-21T00:00:00Z", y: 3 },
          ],
        },
      ],
    });

    const start = at("Load, 2026-10-20T00").x;
    const quarter = at("Load, 2026-10-20T06").x;
    const end = at("Load, 2026-10-21").x;
    expect(quarter - start).toBeCloseTo((end - start) / 4, 0);
  });

  it("leaves a gap where a series has no point, rather than drawing a line across it", () => {
    const { svg, at } = chart({
      kind: "line-chart",
      title: "A missing month",
      series: [
        {
          name: "Full",
          points: ["Jan", "Feb", "Mar", "Apr"].map((x, y) => ({ x, y })),
        },
        {
          name: "Gap",
          points: ["Jan", "Feb", "Apr"].map((x, y) => ({ x, y: y + 5 })),
        },
      ],
    });

    const march = at("Full, Mar").x;
    const lines = [...svg.querySelectorAll("polyline")].map((line) =>
      (line.getAttribute("points") ?? "")
        .trim()
        .split(" ")
        .map((pair) => Number(pair.split(",")[0])),
    );
    for (const xs of lines.slice(1))
      expect(Math.min(...xs) < march && Math.max(...xs) > march).toBe(false);
  });

  it("lists the x values in the Data tab in the order of the axis", () => {
    chart({
      kind: "line-chart",
      title: "Months that join",
      series: [
        {
          name: "A",
          points: ["Jan", "Feb", "Apr"].map((x, y) => ({ x, y })),
        },
        { name: "B", points: ["Mar", "Apr"].map((x, y) => ({ x, y })) },
      ],
    });

    expect(dataRows().map((row) => row[0])).toEqual([
      "Jan",
      "Feb",
      "Mar",
      "Apr",
    ]);
  });

  it("keeps every series' values in the Data tab when one gives its x as numbers and another as words", () => {
    chart({
      kind: "line-chart",
      title: "Mixed",
      series: [
        { name: "A", points: [1, 2].map((x) => ({ x, y: x * 10 })) },
        {
          name: "B",
          points: ["1", "2"].map((x) => ({ x, y: Number(x) * 10 + 1 })),
        },
      ],
    });

    expect(dataRows()).toEqual([
      ["1", "10", "11"],
      ["2", "20", "21"],
    ]);
  });

  it("lists dates in the Data tab from earliest to latest", () => {
    chart({
      kind: "line-chart",
      title: "Dates that join",
      series: [
        {
          name: "A",
          points: ["2026-03-01", "2026-01-15"].map((x, y) => ({ x, y })),
        },
        { name: "B", points: [{ x: "2026-02-01", y: 1 }] },
      ],
    });

    expect(dataRows().map((row) => row[0])).toEqual([
      "2026-01-15",
      "2026-02-01",
      "2026-03-01",
    ]);
  });

  it("reads a date and a time of day without a zone on one clock, whatever the computer's zone", () => {
    chart({
      kind: "line-chart",
      title: "Load",
      series: [
        {
          name: "Load",
          points: [
            { x: "2026-01-16", y: 3 },
            { x: "2026-01-15T00:30", y: 2 },
            { x: "2026-01-15", y: 1 },
          ],
        },
      ],
    });

    expect(dataRows().map((row) => row[0])).toEqual([
      "2026-01-15",
      "2026-01-15T00:30",
      "2026-01-16",
    ]);
  });

  it("takes a day no calendar has for a word, not for the day it would roll over to", () => {
    chart({
      kind: "line-chart",
      title: "Sales",
      series: [
        {
          name: "Sales",
          points: [
            { x: "2026-02-27", y: 1 },
            { x: "2026-02-30", y: 2 },
            { x: "2026-03-01", y: 3 },
          ],
        },
      ],
    });

    expect(dataRows().map((row) => row[0])).toEqual([
      "2026-02-27",
      "2026-02-30",
      "2026-03-01",
    ]);
  });

  it("reads no day or time of day a clock does not have as a time", () => {
    for (const x of [
      "2026-02-30",
      "2026-13-01",
      "2026-01-15T24:00",
      "2026-01-15T10:60",
      "2026-01-15T10:00:60",
      "2026-01-15T10:00+24:00",
      "2026-01-15T10:00+08:60",
    ])
      expect(timeOf(x), x).toBeUndefined();
    expect(timeOf("2026-01-15T23:59:59.5")).toBe(
      Date.UTC(2026, 0, 15, 23, 59, 59, 500),
    );
    // A year under 100 is that year, not one in the 1900s.
    expect(new Date(timeOf("0050-03-01")!).getUTCFullYear()).toBe(50);
  });

  it("reads a time given with its zone as the moment it names", () => {
    const midnight = timeOf("2026-01-15");
    expect(timeOf("2026-01-15T08:00+08:00")).toBe(midnight);
    expect(timeOf("2026-01-14T19:00-05:00")).toBe(midnight);
    expect(timeOf("2026-01-15T00:00Z")).toBe(midnight);
  });

  it("lists numbers on the x axis in the Data tab from smallest to largest", () => {
    chart({
      kind: "line-chart",
      title: "Numbers that join",
      series: [
        { name: "A", points: [1, 3].map((x) => ({ x, y: x })) },
        { name: "B", points: [2, 4].map((x) => ({ x, y: x })) },
      ],
    });

    expect(dataRows().map((row) => row[0])).toEqual(["1", "2", "3", "4"]);
  });
});

describe("the axes of charts whose data sits far from zero", () => {
  it("spreads a scatter plot's points across the plot, its axes spanning the data", () => {
    const { marks, plot, ticks, valueTicks } = chart({
      kind: "scatter-plot",
      title: "Price by year built",
      series: [
        {
          name: "Houses",
          points: Array.from({ length: 31 }, (_, index) => ({
            x: 1990 + index,
            y: 50 + (index % 7),
          })),
        },
      ],
    });

    const xs = marks.map((mark) => mark.x);
    const ys = marks.map((mark) => mark.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(
      0.8 * (plot.right - plot.left),
    );
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(150);
    expect(ticks).not.toContain("0");
    expect(ticks).toContain("1990");
    expect(ticks).toContain("2020");
    // Labelled at round values, not at the ends of the span.
    expect(valueTicks.length).toBeGreaterThan(1);
    for (const tick of valueTicks) expect(Number(tick) % 2).toBe(0);
  });

  it("spreads a line chart's values over its height when they sit far from zero", () => {
    const { marks, valueTicks } = chart({
      kind: "line-chart",
      title: "Latency",
      series: [
        {
          name: "Latency",
          points: [1000, 1040, 1020, 1100, 1060].map((y, x) => ({ x, y })),
        },
      ],
    });

    const ys = marks.map((mark) => mark.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(150);
    expect(valueTicks).not.toContain("0");
    expect(valueTicks.length).toBeGreaterThan(1);
  });

  it("draws a box plot's boxes tall enough to read when the values sit far from zero", () => {
    const { marks } = chart({
      kind: "box-plot",
      title: "Latency",
      groups: [
        { label: "Before", values: [1000, 1020, 1040, 1060, 1080, 1100] },
        { label: "After", values: [1010, 1015, 1030, 1045, 1050] },
      ],
    });

    for (const box of marks) expect(box.height).toBeGreaterThan(40);
  });

  it("gives a box plot's quartiles in the Data tab as they are, not rounded", () => {
    chart({
      kind: "box-plot",
      title: "Latency",
      groups: [{ label: "Before", values: [1001, 1003, 1005, 1007, 1009] }],
    });

    expect(dataRows()[0]).toEqual([
      "Before",
      "5",
      "1001",
      "1003",
      "1005",
      "1007",
      "1009",
    ]);
  });

  it("keeps a bar chart's bars measured from zero", () => {
    const { ticks } = chart({
      kind: "bar-chart",
      title: "Sales",
      categories: [
        { label: "North", value: 1000 },
        { label: "South", value: 1100 },
      ],
    });

    expect(ticks).toContain("0");
  });
});
