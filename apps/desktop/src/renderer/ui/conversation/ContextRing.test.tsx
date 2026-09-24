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
      draftTokens={0}
      onChoose={onChoose}
      disabled={false}
      {...props}
    />,
  );
  return { ...view, onChoose };
}

describe("the context ring", () => {
  it("fills as the next request nears the budget, and the breakdown shows the same number", () => {
    ring({ usage: usage(131_000) });

    const meter = screen.getByRole("button", { name: /Context/ });
    expect(meter).toHaveAccessibleName("Context: 50% of the Medium budget");
    fireEvent.click(meter);
    fireEvent.click(screen.getByRole("button", { name: "What's using space" }));

    const breakdown = screen.getByRole("dialog", {
      name: "What's using space",
    });
    expect(within(breakdown).getByText("50% of 262K")).toBeVisible();
    expect(within(breakdown).getByText("Tool results")).toBeVisible();
    expect(within(breakdown).getByText("30,000")).toBeVisible();
    expect(
      within(breakdown).getByText("Counted by the provider"),
    ).toBeVisible();
    expect(within(breakdown).getByText("1,000,000")).toBeVisible();
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
    expect(screen.getByText(/costs more on every request/)).toBeVisible();
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
      screen.getByText(
        /Low and Medium give the same room on this model: its window leaves no more/,
      ),
    ).toBeVisible();
  });

  it("is never shown as empty when the size or the window is not known", () => {
    const { rerender } = ring();

    expect(
      screen.getByRole("button", { name: /Context/ }),
    ).toHaveAccessibleName("Context: size not known yet");
    rerender(
      <ContextRing
        usage={usage(20_000)}
        model={{ model: "unlisted" }}
        budget="medium"
        draftTokens={0}
        onChoose={() => {}}
        disabled={false}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Context/ }),
    ).toHaveAccessibleName("Context: size not known yet");
  });

  it("follows a model switch, a budget change and the message being written", () => {
    const { rerender } = ring({ usage: usage(131_000) });
    const draw = (props: Partial<Parameters<typeof ContextRing>[0]>) =>
      rerender(
        <ContextRing
          usage={usage(131_000)}
          model={wide}
          budget="medium"
          draftTokens={0}
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
    draw({ draftTokens: 26_200 });
    expect(
      screen.getByRole("button", { name: /Context/ }),
    ).toHaveAccessibleName("Context: 60% of the Medium budget");
  });

  it("says when instructions and tools alone take too much of the budget", () => {
    ring({ usage: usage(40_000, 30_000), budget: "low" });

    fireEvent.click(screen.getByRole("button", { name: /Context/ }));

    expect(screen.getByText(/Instructions and tools take 23%/)).toBeVisible();
  });
});
