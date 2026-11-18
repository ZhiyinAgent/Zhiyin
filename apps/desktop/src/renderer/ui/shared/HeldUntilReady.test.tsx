import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeldUntilReady } from "./HeldUntilReady.js";

/** An item that counts its own clicks, so a remount shows as a count lost. */
function Item({ name }: { name: string }) {
  const [clicks, setClicks] = useState(0);
  return (
    <button type="button" onClick={() => setClicks(clicks + 1)}>
      {name} {clicks}
    </button>
  );
}

/** Says it is ready once it is told it is. */
function Readied({
  name,
  ready,
  isReady,
}: {
  name: string;
  ready: () => void;
  isReady: boolean;
}) {
  useEffect(() => {
    if (isReady) ready();
  }, [isReady, ready]);
  return <Item name={name} />;
}

type Shown = {
  readonly item: string;
  readonly waits?: boolean;
  readonly isReady?: boolean;
};

function shown(props: Shown & { onReady?: () => void }) {
  const { onReady, ...value } = props;
  return (
    <HeldUntilReady
      value={value}
      itemOf={(shown: Shown) => shown.item}
      waits={(shown: Shown) => shown.waits ?? true}
      {...(onReady ? { onReady } : {})}
      render={(shown, ready) => (
        <Readied
          name={shown.item}
          ready={ready}
          isReady={shown.isReady ?? false}
        />
      )}
    />
  );
}

afterEach(() => vi.useRealTimers());

describe("HeldUntilReady", () => {
  it("shows the first item at once, with nothing to hold", () => {
    render(shown({ item: "scene" }));
    expect(screen.getByRole("button", { name: "scene 0" })).toBeVisible();
  });

  it("keeps the earlier item on screen while the next gets ready, then shows the next", () => {
    const { rerender } = render(shown({ item: "scene" }));
    fireEvent.click(screen.getByRole("button", { name: "scene 0" }));

    rerender(shown({ item: "stand.png" }));
    expect(screen.getByRole("button", { name: "scene 1" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "stand.png 0" })).toBeNull();

    fireEvent.click(screen.getByText("stand.png 0"));
    rerender(shown({ item: "stand.png", isReady: true }));
    expect(screen.queryByText(/scene/)).toBeNull();
    // Shown, it is the same one that waited, and keeps what was done to it.
    expect(screen.getByRole("button", { name: "stand.png 1" })).toBeVisible();
  });

  it("shows the next item after a second, ready or not", () => {
    vi.useFakeTimers();
    const { rerender } = render(shown({ item: "scene" }));
    rerender(shown({ item: "stand.png" }));
    expect(screen.getByRole("button", { name: "scene 0" })).toBeVisible();

    act(() => vi.advanceTimersByTime(999));
    expect(screen.getByRole("button", { name: "scene 0" })).toBeVisible();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText(/scene/)).toBeNull();
    expect(screen.getByRole("button", { name: "stand.png 0" })).toBeVisible();
  });

  it("shows an item that has nothing to get ready at once", () => {
    const { rerender } = render(shown({ item: "scene" }));
    rerender(shown({ item: "page", waits: false }));
    expect(screen.queryByText(/scene/)).toBeNull();
    expect(screen.getByRole("button", { name: "page 0" })).toBeVisible();
  });

  it("lets go of the earlier item once the next turns out to have nothing to wait for", () => {
    const { rerender } = render(shown({ item: "scene" }));
    rerender(shown({ item: "stand.png" }));
    rerender(shown({ item: "stand.png", waits: false }));
    expect(screen.queryByText(/scene/)).toBeNull();
    expect(screen.getByRole("button", { name: "stand.png 0" })).toBeVisible();
  });

  it("keeps the item first held while a newer one replaces the one getting ready", () => {
    const { rerender } = render(shown({ item: "scene" }));
    rerender(shown({ item: "v10.png" }));
    rerender(shown({ item: "v11.png" }));
    expect(screen.getByRole("button", { name: "scene 0" })).toBeVisible();
    expect(screen.queryByText(/v10/)).toBeNull();

    rerender(shown({ item: "v11.png", isReady: true }));
    expect(screen.queryByText(/scene/)).toBeNull();
    expect(screen.getByRole("button", { name: "v11.png 0" })).toBeVisible();
  });

  it("says when what it shows is ready: at once for an item that has nothing to wait for", () => {
    const onReady = vi.fn();
    const { rerender } = render(
      shown({ item: "scene", waits: false, onReady }),
    );
    expect(onReady).toHaveBeenCalledTimes(1);

    rerender(shown({ item: "stand.png", onReady }));
    expect(onReady).toHaveBeenCalledTimes(1);
    rerender(shown({ item: "stand.png", isReady: true, onReady }));
    expect(onReady).toHaveBeenCalledTimes(2);
  });
});
