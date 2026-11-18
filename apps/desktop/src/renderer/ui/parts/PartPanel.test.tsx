/**
 * The part view as the person meets it: the parts listed with their sizes,
 * the build drawn once its mesh arrives, turning and zooming from the mouse
 * or the keyboard, and what it says when it cannot draw. The drawing itself
 * is a stand-in here; the lab shows the real one.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PartModel, PartsPanelState } from "@zhiyin/contract";
import { startingOrbit, turned, zoomed } from "./orbit.js";
import { PartPanel } from "./PartPanel.js";
import type { ParsedParts, PartView } from "./partView.js";

const gear: PartsPanelState = {
  sequence: 4,
  parts: [
    { name: "Gear", size: [30, 30, 10], valid: true },
    { name: "Shaft", size: [5, 5, 40.25], valid: false },
  ],
  script: "gear/mixer-gear.py",
};

/** A build's mesh, which here holds only the build's number. */
const model = (sequence: number): PartModel => ({
  sequence,
  data: new Uint8Array([sequence]),
});

/**
 * A stand-in for the WebGL drawing, which says which builds it put on screen
 * and which it let go of unseen. With `waits`, reading a mesh finishes only
 * when the test lets it, so builds can finish in any order.
 */
function fakeView({ waits = false } = {}) {
  const waiting = new Map<number, () => void>();
  const view = {
    shown: [] as number[],
    discarded: [] as number[],
    looks: [] as unknown[],
    disposed: false,
    parse: vi.fn(async (data: Uint8Array): Promise<ParsedParts> => {
      const build = data[0]!;
      if (waits)
        await new Promise<void>((resolve) => waiting.set(build, resolve));
      return {
        show: () => void view.shown.push(build),
        discard: () => void view.discarded.push(build),
      };
    }),
    /** Lets reading this build's mesh finish. */
    finish: (build: number) => waiting.get(build)?.(),
    look: vi.fn((orbit: unknown) => {
      view.looks.push(orbit);
    }),
    resize: vi.fn(),
    dispose: vi.fn(() => {
      view.disposed = true;
    }),
  };
  return view satisfies PartView;
}

const settle = () => act(async () => {});

describe("the part view", () => {
  it("lists each part with its size, says which is not a valid solid, and names the script", async () => {
    const view = fakeView();
    render(
      <PartPanel
        parts={gear}
        loadModel={async (sequence) => model(sequence)}
        createView={() => view}
      />,
    );
    await settle();

    expect(
      screen.getByRole("heading", { name: "mixer-gear.py" }),
    ).toBeVisible();
    const list = screen.getByRole("list", { name: "Parts built" });
    expect(list).toHaveTextContent("Gear30 × 30 × 10 mm");
    expect(list).toHaveTextContent("Shaft5 × 5 × 40.25 mm · not a valid solid");
  });

  it("draws the build shown, then each new build, and never a build replaced before it arrived", async () => {
    const view = fakeView();
    const asked: number[] = [];
    let release: (() => void) | undefined;
    const { rerender } = render(
      <PartPanel
        parts={gear}
        loadModel={async (sequence) => {
          asked.push(sequence);
          // The first build's mesh arrives only after the next build exists.
          if (sequence === 4)
            await new Promise<void>((resolve) => (release = resolve));
          return model(sequence);
        }}
        createView={() => view}
      />,
    );
    rerender(
      <PartPanel
        parts={{ ...gear, sequence: 5 }}
        loadModel={async (sequence) => {
          asked.push(sequence);
          return sequence === 5 ? model(5) : undefined;
        }}
        createView={() => view}
      />,
    );
    await settle();
    release?.();
    await settle();

    expect(asked).toEqual([4, 5]);
    expect(view.shown).toEqual([5]);
    expect(screen.queryByText("Drawing the parts…")).toBeNull();
  });

  it("keeps the newer build on screen when an older one finishes reading after it", async () => {
    const view = fakeView({ waits: true });
    const { rerender } = render(
      <PartPanel
        parts={gear}
        loadModel={async (sequence) => model(sequence)}
        createView={() => view}
      />,
    );
    await settle();
    rerender(
      <PartPanel
        parts={{ ...gear, sequence: 5 }}
        loadModel={async (sequence) => model(sequence)}
        createView={() => view}
      />,
    );
    await settle();

    view.finish(5);
    await settle();
    view.finish(4);
    await settle();

    expect(view.shown).toEqual([5]);
    expect(view.discarded).toEqual([4]);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("says the parts are being drawn in a status line outside the drawing, and names the drawing for what it holds", async () => {
    const view = fakeView({ waits: true });
    render(
      <PartPanel
        parts={gear}
        loadModel={async (sequence) => model(sequence)}
        createView={() => view}
      />,
    );
    await settle();

    const drawing = screen.getByRole("img");
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Drawing the parts…");
    expect(drawing).not.toContainElement(status);
    expect(drawing).toHaveAccessibleName(
      "The parts in 3D, once they are drawn",
    );

    view.finish(gear.sequence);
    await settle();

    // The same status line stays, emptied, so a screen reader hears changes.
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toBeEmptyDOMElement();
    expect(drawing).toHaveAccessibleName(
      "The parts in 3D. Drag or use the arrow keys to turn them, scroll or use plus and minus to zoom, Home to go back.",
    );
  });

  it("turns and zooms from the keyboard, and goes back to the first angle", async () => {
    const view = fakeView();
    render(
      <PartPanel
        parts={gear}
        loadModel={async (sequence) => model(sequence)}
        createView={() => view}
      />,
    );
    await settle();
    const stage = screen.getByRole("img", {
      name: /Drag or use the arrow keys/,
    });

    fireEvent.keyDown(stage, { key: "ArrowLeft" });
    expect(view.looks.at(-1)).toEqual(turned(startingOrbit, 15, 0));
    fireEvent.keyDown(stage, { key: "+" });
    expect(view.looks.at(-1)).toEqual(
      zoomed(turned(startingOrbit, 15, 0), 1.15),
    );
    fireEvent.keyDown(stage, { key: "Home" });
    expect(view.looks.at(-1)).toEqual(startingOrbit);
    fireEvent.keyDown(stage, { key: "ArrowUp" });
    fireEvent.click(
      screen.getByRole("button", { name: "Back to the first angle" }),
    );
    expect(view.looks.at(-1)).toEqual(startingOrbit);
  });

  it("shows the next build from the angle the person turned to", async () => {
    const view = fakeView();
    const { rerender } = render(
      <PartPanel
        parts={gear}
        loadModel={async (sequence) => model(sequence)}
        createView={() => view}
      />,
    );
    await settle();
    fireEvent.keyDown(screen.getByRole("img"), { key: "ArrowLeft" });
    const turnedTo = view.looks.at(-1);
    expect(turnedTo).not.toEqual(startingOrbit);

    rerender(
      <PartPanel
        parts={{ ...gear, sequence: gear.sequence + 1 }}
        loadModel={async (sequence) => model(sequence)}
        createView={() => view}
      />,
    );
    await settle();

    expect(view.shown).toEqual([gear.sequence, gear.sequence + 1]);
    expect(view.looks.at(-1)).toEqual(turnedTo);
  });

  it("says when this computer cannot draw 3D, and still lists the parts", async () => {
    render(
      <PartPanel
        parts={gear}
        loadModel={async (sequence) => model(sequence)}
        createView={() => {
          throw new Error("WebGL is not available");
        }}
      />,
    );
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This computer cannot draw the parts in 3D here.",
    );
    expect(screen.getByRole("list", { name: "Parts built" })).toHaveTextContent(
      "Gear",
    );
  });

  it("says why a build could not be drawn", async () => {
    const view = fakeView();
    view.parse.mockRejectedValueOnce(new Error("The mesh is damaged."));
    render(
      <PartPanel
        parts={gear}
        loadModel={async (sequence) => model(sequence)}
        createView={() => view}
      />,
    );
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The mesh the build wrote could not be drawn. Building the parts again makes a new one.",
    );
  });

  it("says the mesh could not be drawn when it could not be read, rather than drawing on", async () => {
    render(
      <PartPanel
        parts={gear}
        loadModel={async () => {
          throw new Error("The mesh the build wrote could not be read.");
        }}
        createView={() => fakeView()}
      />,
    );
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The mesh the build wrote could not be drawn. Building the parts again makes a new one.",
    );
    expect(screen.queryByText("Drawing the parts…")).toBeNull();
  });

  it("gives the room of a drawing it could not make to the sizes, until the next build draws", async () => {
    const view = fakeView();
    view.parse.mockRejectedValueOnce(new Error("The mesh is damaged."));
    const { rerender } = render(
      <PartPanel
        parts={gear}
        loadModel={async (sequence) => model(sequence)}
        createView={() => view}
      />,
    );
    await settle();

    expect(screen.queryByRole("img")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Back to the first angle" }),
    ).toBeDisabled();

    rerender(
      <PartPanel
        parts={{ ...gear, sequence: gear.sequence + 1 }}
        loadModel={async (sequence) => model(sequence)}
        createView={() => view}
      />,
    );
    await settle();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("img")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Back to the first angle" }),
    ).toBeEnabled();
  });

  it("lets go of its drawing when it closes", async () => {
    const view = fakeView();
    const { unmount } = render(
      <PartPanel
        parts={gear}
        loadModel={async (sequence) => model(sequence)}
        createView={() => view}
      />,
    );
    await settle();
    unmount();
    expect(view.disposed).toBe(true);
  });
});
