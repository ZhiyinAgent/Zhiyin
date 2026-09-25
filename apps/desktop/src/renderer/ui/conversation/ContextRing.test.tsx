import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ContextUsage } from "@zhiyin/contract";
import { ContextRing } from "./ContextRing.js";

const wide = {
  model: "wide",
  contextWindow: 1_000_000,
  maximumOutputTokens: 131_072,
};

function usage(totalTokens: number, fixed = 5_000): ContextUsage {
  return {
    model: "wide",
    totalTokens,
    measured: true,
    parts: {
      instructions: 1_000,
      tools: fixed - 1_000,
      summary: 0,
      conversation: totalTokens - fixed - 30_000,
      toolResults: 30_000,
    },
  };
}

function ring(props: Partial<Parameters<typeof ContextRing>[0]> = {}) {
  const onChoose = vi.fn();
  const view = render(
    <ContextRing
      model={wide}
      budget="medium"
      onChoose={onChoose}
      disabled={false}
      {...props}
    />,
  );
  return { ...view, onChoose };
}

describe("the context ring", () => {
  it("fills as the next request nears the budget, and the breakdown says in plain words what uses it, explained on hover or focus", () => {
    ring({ usage: usage(131_000) });

    const meter = screen.getByRole("button", { name: /Context/ });
    expect(meter).toHaveAccessibleName("Context: 50% of the Medium budget");
    fireEvent.click(meter);
    fireEvent.click(screen.getByRole("button", { name: "What's using space" }));

    const breakdown = screen.getByRole("dialog", {
      name: "What's using space",
    });
    expect(
      within(breakdown).getByText("50% of the Medium budget (262K)"),
    ).toBeVisible();
    const row = (part: string) =>
      within(breakdown).queryByRole("row", { name: new RegExp(`^${part}`) });
    expect(row("Setup")).toHaveTextContent("5K");
    expect(row("Conversation")).toHaveTextContent("126K");
    expect(row("Free")).toHaveTextContent("131K");
    expect(row("Summary")).toBeNull();
    expect(within(breakdown).queryByText("Estimated")).toBeNull();

    const about = within(breakdown).getByRole("button", {
      name: "What is Setup?",
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseEnter(about);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent(
      "Zhiyin's instructions and the tools it can use. Sent with every message.",
    );
    expect(about).toHaveAccessibleDescription(tip.textContent!);
    fireEvent.mouseLeave(about);
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.focus(about);
    expect(screen.getByRole("tooltip")).toBeVisible();
    fireEvent.blur(about);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("says in the breakdown when the limit was lowered after the provider refused a request", () => {
    ring({
      usage: usage(4_000),
      model: { ...wide, contextWindow: 7_000, refusedTokens: 8_200 },
    });

    fireEvent.click(screen.getByRole("button", { name: /Context/ }));
    fireEvent.click(screen.getByRole("button", { name: "What's using space" }));

    expect(
      within(screen.getByRole("dialog")).getByText(
        "Limit lowered after the provider refused a request of 8K tokens.",
      ),
    ).toBeVisible();
  });

  it("offers Low, Medium and Ultra with their real targets on a 1M model, and says a larger one costs more", () => {
    const { onChoose } = ring({ usage: usage(20_000) });

    fireEvent.click(screen.getByRole("button", { name: /Context/ }));

    const choices = screen.getByRole("radiogroup", { name: "Context budget" });
    expect(
      within(choices).getByRole("radio", { name: /Low.*128K/ }),
    ).toBeVisible();
    expect(
      within(choices).getByRole("radio", { name: /Medium.*262K/ }),
    ).toBeChecked();
    expect(
      within(choices).getByRole("radio", { name: /Ultra.*850K/ }),
    ).toBeVisible();
    expect(screen.getByText("Larger costs more per request")).toBeVisible();
    fireEvent.click(within(choices).getByRole("radio", { name: /Low/ }));
    expect(onChoose).toHaveBeenCalledWith("low");
  });

  it("offers no Ultra below 300k, and shows Medium for a conversation set to Ultra", () => {
    ring({
      usage: usage(20_000),
      model: { model: "small", contextWindow: 200_000 },
      budget: "ultra",
    });

    fireEvent.click(screen.getByRole("button", { name: /Context/ }));

    const choices = screen.getByRole("radiogroup", { name: "Context budget" });
    expect(within(choices).getAllByRole("radio")).toHaveLength(2);
    expect(
      within(choices).getByRole("radio", { name: /Medium/ }),
    ).toBeChecked();
  });

  it("says why two budgets give the same room on a small model", () => {
    ring({
      usage: usage(20_000),
      model: { model: "small", contextWindow: 64_000 },
    });

    fireEvent.click(screen.getByRole("button", { name: /Context/ }));

    expect(screen.getByRole("radio", { name: /Low.*45K/ })).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /Medium.*45K/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Low and Medium are equal on this model"),
    ).toBeVisible();
  });

  it("starts a new conversation at 0%, and says so when the window is not known", () => {
    const { rerender } = ring();

    expect(
      screen.getByRole("button", { name: /Context/ }),
    ).toHaveAccessibleName("Context: 0% of the Medium budget");
    rerender(
      <ContextRing
        usage={usage(20_000)}
        model={{ model: "unlisted" }}
        budget="medium"
        onChoose={() => {}}
        disabled={false}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Context/ }),
    ).toHaveAccessibleName("Context: size not known yet");
  });

  it("draws no arc once a new conversation starts at 0%, however full the last one was", () => {
    const { container, rerender } = ring({ usage: usage(131_000) });
    const arc = () => container.querySelector("circle[pathLength]");
    expect(arc()).toHaveStyle({ strokeDasharray: "50 100" });

    rerender(
      <ContextRing
        model={wide}
        budget="medium"
        onChoose={() => {}}
        disabled={false}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Context/ }),
    ).toHaveAccessibleName("Context: 0% of the Medium budget");
    expect(arc()).toBeNull();
  });

  it("follows a model switch and a budget change", () => {
    const { rerender } = ring({ usage: usage(131_000) });
    const draw = (props: Partial<Parameters<typeof ContextRing>[0]>) =>
      rerender(
        <ContextRing
          usage={usage(131_000)}
          model={wide}
          budget="medium"
          onChoose={() => {}}
          disabled={false}
          {...props}
        />,
      );

    draw({ budget: "low" });
    expect(
      screen.getByRole("button", { name: /Context/ }),
    ).toHaveAccessibleName("Context: 102% of the Low budget");
    draw({ model: { model: "mid", contextWindow: 262_144 } });
    expect(
      screen.getByRole("button", { name: /Context/ }),
    ).toHaveAccessibleName("Context: 59% of the Medium budget");
  });

  it("is reachable by keyboard: opening it moves focus to the chosen budget, and Escape returns it", () => {
    ring({ usage: usage(131_000) });

    const meter = screen.getByRole("button", { name: /Context/ });
    meter.focus();
    fireEvent.click(meter);

    expect(screen.getByRole("radio", { name: /Medium/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("radio", { name: /Medium/ }), {
      key: "Escape",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(meter).toHaveFocus();
  });

  it("compacts on request, saying so until it is done", async () => {
    let finish = () => {};
    const onCondense = vi.fn(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    ring({ usage: usage(131_000), onCondense });

    fireEvent.click(screen.getByRole("button", { name: /Context/ }));
    fireEvent.click(screen.getByRole("button", { name: "Compact" }));

    expect(onCondense).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Compacting…" })).toBeDisabled();
    finish();
    expect(
      await screen.findByRole("button", { name: "Compact" }),
    ).toBeEnabled();
  });

  it("says why it could not compact, and offers nothing to compact before a conversation exists", async () => {
    const { unmount } = ring({
      usage: usage(131_000),
      onCondense: () =>
        Promise.reject(new Error("Saved history is unavailable.")),
    });
    fireEvent.click(screen.getByRole("button", { name: /Context/ }));
    fireEvent.click(screen.getByRole("button", { name: "Compact" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't compact: Saved history is unavailable.",
    );
    unmount();

    ring();
    fireEvent.click(screen.getByRole("button", { name: /Context/ }));
    expect(screen.queryByRole("button", { name: "Compact" })).toBeNull();
  });

  it("says when instructions and tools alone take too much of the budget", () => {
    ring({ usage: usage(40_000, 30_000), budget: "low" });

    fireEvent.click(screen.getByRole("button", { name: /Context/ }));

    expect(screen.getByText(/Instructions and tools take 23%/)).toBeVisible();
  });
});
