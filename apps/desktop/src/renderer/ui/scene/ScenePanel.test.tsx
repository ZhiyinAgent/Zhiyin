import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScenePanelState, ScenePreview } from "@zhiyin/contract";
import { ScenePanel } from "./ScenePanel.js";
import { SceneSurface } from "./SceneSurface.js";

const picture = (sequence: number, data = `P${sequence}`): ScenePreview => ({
  data,
  width: 640,
  height: 360,
  view: "camera",
  sequence,
});

const open = (change: Partial<ScenePanelState> = {}): ScenePanelState => ({
  status: "open",
  file: "scenes/shelf.blend",
  view: "camera",
  working: false,
  preview: picture(1),
  ...change,
});

const shownPictures = (container: HTMLElement) =>
  [...container.querySelectorAll("img")].map((image) =>
    image.getAttribute("src"),
  );

/**
 * Pictures decode when a test says so, as a large one does some time after it
 * arrives. Each decode waits on the next call to `finish`.
 */
function slowDecoding() {
  const waiting: { resolve: () => void; reject: () => void }[] = [];
  Object.defineProperty(HTMLImageElement.prototype, "decode", {
    configurable: true,
    value: () =>
      new Promise<void>((resolve, reject) => waiting.push({ resolve, reject })),
  });
  return {
    async finish(outcome: "decoded" | "broken" = "decoded") {
      await act(async () => {
        const next = waiting.shift();
        if (outcome === "decoded") next?.resolve();
        else next?.reject();
      });
    },
  };
}

// The window draws pictures and captures the pointer; jsdom does neither.
beforeEach(() => {
  Object.defineProperty(Element.prototype, "setPointerCapture", {
    configurable: true,
    value: () => {},
  });
  Object.defineProperty(HTMLImageElement.prototype, "decode", {
    configurable: true,
    value: () => Promise.resolve(),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (HTMLImageElement.prototype as { decode?: unknown }).decode;
});

describe("ScenePanel", () => {
  it("names the scene's file and shows its picture", () => {
    const { container } = render(
      <ScenePanel scene={open()} onLook={() => undefined} />,
    );
    expect(screen.getByRole("heading", { name: "shelf.blend" })).toBeVisible();
    expect(shownPictures(container)).toEqual(["data:image/jpeg;base64,P1"]);
  });

  it("says Blender is starting, then working, while it is", () => {
    const { rerender } = render(
      <ScenePanel
        scene={{ status: "starting", view: "camera", working: false }}
        onLook={() => undefined}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Starting Blender…");

    rerender(
      <ScenePanel scene={open({ working: true })} onLook={() => undefined} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Working…");

    rerender(<ScenePanel scene={open()} onLook={() => undefined} />);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("says an empty scene is empty rather than showing a blank picture", () => {
    render(
      <ScenePanel
        scene={open({ preview: { ...picture(1), empty: true } })}
        onLook={() => undefined}
      />,
    );
    expect(
      screen.getByText(
        "The scene is empty. What the agent makes appears here.",
      ),
    ).toBeVisible();
  });

  it("zooms the shown picture at once, until Blender draws the closer one", async () => {
    const { container, rerender } = render(
      <ScenePanel
        scene={open({ view: "overview" })}
        onLook={() => undefined}
      />,
    );
    const view = screen.getByRole("img");
    const scale = () =>
      Number(
        /scale\(([\d.]+)\)/.exec(
          container.querySelector<HTMLElement>("img:last-of-type")?.style
            .transform ?? "",
        )?.[1] ?? 1,
      );

    fireEvent.wheel(view, { deltaY: -200 });
    expect(scale()).toBeGreaterThan(1.2);

    rerender(
      <ScenePanel
        scene={open({ view: "overview", preview: picture(2) })}
        onLook={() => undefined}
      />,
    );
    await act(async () => {});
    expect(scale()).toBe(1);
  });

  it("keeps the last picture on screen until the next one can be drawn whole", async () => {
    const decoding = slowDecoding();
    const { container, rerender } = render(
      <ScenePanel scene={open()} onLook={() => undefined} />,
    );

    rerender(
      <ScenePanel
        scene={open({ preview: picture(2) })}
        onLook={() => undefined}
      />,
    );
    expect(shownPictures(container)).toEqual(["data:image/jpeg;base64,P1"]);

    await decoding.finish();
    // The new picture settles over the old one, so there is never a gap.
    expect(shownPictures(container)).toEqual([
      "data:image/jpeg;base64,P1",
      "data:image/jpeg;base64,P2",
    ]);
  });

  it("keeps the last good picture when a new one will not decode", async () => {
    const decoding = slowDecoding();
    const { container, rerender } = render(
      <ScenePanel scene={open()} onLook={() => undefined} />,
    );
    rerender(
      <ScenePanel
        scene={open({ preview: picture(2, "broken") })}
        onLook={() => undefined}
      />,
    );
    await decoding.finish("broken");
    expect(shownPictures(container)).toEqual(["data:image/jpeg;base64,P1"]);
  });

  it("turns the overview by dragging, sending what built up at a steady pace", () => {
    vi.useFakeTimers();
    const onLook = vi.fn();
    render(<ScenePanel scene={open({ view: "overview" })} onLook={onLook} />);
    const view = screen.getByRole("img");

    fireEvent.pointerDown(view, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(view, { pointerId: 1, clientX: 110, clientY: 100 });
    fireEvent.pointerMove(view, { pointerId: 1, clientX: 120, clientY: 110 });
    expect(onLook).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(80));
    // Twenty pixels right turns the view 8° the other way; ten down tilts 3°.
    expect(onLook).toHaveBeenCalledTimes(1);
    expect(onLook).toHaveBeenCalledWith({ kind: "turn", yaw: -8, pitch: 3 });
  });

  it("leaves the camera for the overview when the person drags in it", () => {
    vi.useFakeTimers();
    const onLook = vi.fn();
    render(<ScenePanel scene={open()} onLook={onLook} />);
    const view = screen.getByRole("img");

    fireEvent.pointerDown(view, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(view, { pointerId: 1, clientX: 10, clientY: 0 });
    act(() => vi.advanceTimersByTime(80));

    expect(onLook.mock.calls.map(([intent]) => intent)).toEqual([
      { kind: "view", view: "overview" },
      { kind: "turn", yaw: -4, pitch: 0 },
    ]);
  });

  it("turns and zooms from the keyboard, and Home goes back to the first angle", () => {
    vi.useFakeTimers();
    const onLook = vi.fn();
    render(<ScenePanel scene={open({ view: "overview" })} onLook={onLook} />);
    const view = screen.getByRole("img");

    fireEvent.keyDown(view, { key: "ArrowLeft" });
    fireEvent.keyDown(view, { key: "+" });
    act(() => vi.advanceTimersByTime(80));
    expect(onLook.mock.calls.map(([intent]) => intent)).toEqual([
      { kind: "turn", yaw: 15, pitch: 0 },
      { kind: "zoom", factor: 1.15 },
    ]);

    fireEvent.keyDown(view, { key: "Home" });
    expect(onLook).toHaveBeenLastCalledWith({ kind: "reset" });
  });

  it("does not turn before there is a picture to turn", () => {
    vi.useFakeTimers();
    const onLook = vi.fn();
    render(
      <ScenePanel
        scene={{ status: "starting", view: "overview", working: false }}
        onLook={onLook}
      />,
    );
    const view = screen.getByRole("img");
    fireEvent.pointerDown(view, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(view, { pointerId: 1, clientX: 50, clientY: 0 });
    fireEvent.wheel(view, { deltaY: 100 });
    fireEvent.keyDown(view, { key: "ArrowLeft" });
    fireEvent.keyDown(view, { key: "+" });
    fireEvent.keyDown(view, { key: "Home" });
    act(() => vi.advanceTimersByTime(80));
    expect(onLook).not.toHaveBeenCalled();
  });

  it("switches between the camera and the overview, and resets only the overview", () => {
    const onLook = vi.fn();
    const { rerender } = render(<ScenePanel scene={open()} onLook={onLook} />);
    expect(screen.getByRole("button", { name: "Camera" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "Back to the first angle" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(onLook).toHaveBeenCalledWith({ kind: "view", view: "overview" });

    rerender(<ScenePanel scene={open({ view: "overview" })} onLook={onLook} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Back to the first angle" }),
    );
    expect(onLook).toHaveBeenLastCalledWith({ kind: "reset" });
  });

  it("says so when the scene has no camera yet", () => {
    render(
      <ScenePanel
        scene={open({ preview: { ...picture(1), view: "overview" } })}
        onLook={() => undefined}
      />,
    );
    expect(
      screen.getByText("The scene has no camera yet, so this is the overview."),
    ).toBeVisible();
  });

  it("tells Blender the size it is drawn at, in device pixels, once it settles", () => {
    vi.useFakeTimers();
    let resized: (entries: unknown[]) => void = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: (entries: unknown[]) => void) {
          resized = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("devicePixelRatio", 1.5);
    const onLook = vi.fn();
    render(<ScenePanel scene={open()} onLook={onLook} />);

    resized([{ contentRect: { width: 300, height: 200 } }]);
    resized([{ contentRect: { width: 640, height: 360 } }]);
    act(() => vi.advanceTimersByTime(250));

    expect(onLook).toHaveBeenCalledTimes(1);
    expect(onLook).toHaveBeenCalledWith({
      kind: "size",
      width: 960,
      height: 540,
    });
  });

  it("still tells Blender the new size when the scene changes while the view is resizing", () => {
    vi.useFakeTimers();
    let resized: (entries: unknown[]) => void = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: (entries: unknown[]) => void) {
          resized = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("devicePixelRatio", 1);
    const onLook = vi.fn();
    // The window hands the panel a new function each time it draws it.
    const { rerender } = render(
      <ScenePanel scene={open()} onLook={(intent) => onLook(intent)} />,
    );

    resized([{ contentRect: { width: 800, height: 450 } }]);
    act(() => vi.advanceTimersByTime(100));
    rerender(
      <ScenePanel
        scene={open({ working: true })}
        onLook={(intent) => onLook(intent)}
      />,
    );
    act(() => vi.advanceTimersByTime(250));

    expect(onLook).toHaveBeenCalledWith({
      kind: "size",
      width: 800,
      height: 450,
    });
  });

  it("explains that Blender stopped and that the scene comes back", () => {
    render(
      <ScenePanel
        scene={{
          status: "failed",
          view: "camera",
          working: false,
          reason: "Blender did not start.",
        }}
        onLook={() => undefined}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Blender did not start.It starts again from the saved scene when the agent next works on it.",
    );
  });
});

describe("SceneSurface", () => {
  it("offers a way back to the conversation only when Blender stopped", () => {
    const onReturn = vi.fn();
    const { rerender } = render(
      <SceneSurface
        scene={open()}
        onLook={() => undefined}
        onReturn={onReturn}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Return to conversation" }),
    ).toBeNull();

    rerender(
      <SceneSurface
        scene={open({ status: "failed" })}
        onLook={() => undefined}
        onReturn={onReturn}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Return to conversation" }),
    );
    expect(onReturn).toHaveBeenCalled();
  });
});
