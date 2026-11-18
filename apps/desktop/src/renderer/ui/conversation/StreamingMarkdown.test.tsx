import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StreamingMarkdown } from "./StreamingMarkdown.js";

/** Drives the reveal by hand, so the pacing is observable rather than raced. */
let frames: FrameRequestCallback[] = [];

function runFrames(count: number) {
  for (let index = 0; index < count; index += 1) {
    const pending = frames;
    frames = [];
    act(() => pending.forEach((frame) => frame(index)));
  }
}

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => {
    frames.push(frame);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StreamingMarkdown", () => {
  it("reveals a burst of arriving text over several frames instead of at once", () => {
    const arrived = "The quarterly report is ready for review.";
    const { rerender } = render(<StreamingMarkdown text="The" streaming />);
    expect(screen.getByText("The")).toBeVisible();

    rerender(<StreamingMarkdown text={arrived} streaming />);

    // The jump has not been painted in one go.
    expect(screen.queryByText(arrived)).toBeNull();
    runFrames(1);
    expect(screen.queryByText(arrived)).toBeNull();
    runFrames(30);
    expect(screen.getByText(arrived)).toBeVisible();
  });

  /**
   * A finished answer must never be left partly drawn. When the turn ends, the
   * remainder is shown at once rather than continuing to trickle.
   */
  it("shows the whole answer the moment the turn stops running", () => {
    const answer = "A long finished answer that has stopped arriving.";
    const { rerender } = render(<StreamingMarkdown text="A" streaming />);
    rerender(<StreamingMarkdown text={answer} streaming />);
    expect(screen.queryByText(answer)).toBeNull();

    rerender(<StreamingMarkdown text={answer} streaming={false} />);

    expect(screen.getByText(answer)).toBeVisible();
  });

  it("draws text that is not a continuation whole, rather than animating into it", () => {
    const { rerender } = render(
      <StreamingMarkdown text="First message" streaming />,
    );

    rerender(<StreamingMarkdown text="Something else entirely" streaming />);

    expect(screen.getByText("Something else entirely")).toBeVisible();
  });

  it("draws a message that was never streaming immediately", () => {
    render(<StreamingMarkdown text="Already finished." streaming={false} />);

    expect(screen.getByText("Already finished.")).toBeVisible();
  });
});
