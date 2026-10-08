import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiagramView } from "./DiagramView.js";

const drawn: string[] = [];
/** Holds the light drawing back until the test lets it finish. */
let lightDrawing: Promise<void> = Promise.resolve();

vi.mock("./mermaidRuntime.js", () => ({
  renderMermaid: async (_id: string, _source: string, scheme: string) => {
    drawn.push(scheme);
    if (scheme === "light") await lightDrawing;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text>Drawn ${scheme}</text></svg>`;
  },
  diagramGround: (scheme: string) =>
    scheme === "light"
      ? { background: "#ffffff", ink: { light: "#ffffff", dark: "#1a1b1d" } }
      : { background: "#141817", ink: { light: "#f4f2ea", dark: "#141817" } },
}));

/** A window whose light or dark setting the test can change. */
function scheme(initial: "light" | "dark") {
  let light = initial === "light";
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query === "(prefers-color-scheme: light)" ? light : !light;
    },
    media: query,
    addEventListener: (_type: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) =>
      listeners.delete(listener),
  }));
  return (next: "light" | "dark") => {
    light = next === "light";
    listeners.forEach((listener) => listener());
  };
}

afterEach(() => {
  drawn.length = 0;
  lightDrawing = Promise.resolve();
  vi.unstubAllGlobals();
});

describe("a diagram's colours", () => {
  it("are drawn for the theme showing, and drawn again when it changes", async () => {
    const switchTo = scheme("dark");
    render(<DiagramView id="flow" source="flowchart LR\nA --> B" />);
    expect(await screen.findByText("Drawn dark")).toBeVisible();

    act(() => switchTo("light"));

    expect(await screen.findByText("Drawn light")).toBeVisible();
    expect(drawn).toEqual(["dark", "light"]);
  });

  it("keep the drawing showing while the other theme's is drawn", async () => {
    let finish = () => {};
    lightDrawing = new Promise((resolve) => (finish = resolve));
    const switchTo = scheme("dark");
    render(<DiagramView id="flow" source="flowchart LR\nA --> B" />);
    expect(await screen.findByText("Drawn dark")).toBeVisible();

    act(() => switchTo("light"));

    expect(screen.getByText("Drawn dark")).toBeVisible();
    expect(screen.queryByRole("status")).toBeNull();
    finish();
    expect(await screen.findByText("Drawn light")).toBeVisible();
  });
});
