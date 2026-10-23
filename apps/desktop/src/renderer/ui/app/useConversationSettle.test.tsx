import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConversationSettle } from "./useConversationSettle.js";

/** A conversation's lines, as the shell draws them in its scrolling log. */
function Conversation({ id, lines }: { id: string; lines: string[] }) {
  const log = useRef<HTMLDivElement>(null);
  useConversationSettle(log, id);
  return (
    <div ref={log} role="log">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}

const settling = (log: HTMLElement) => log.hasAttribute("data-settling");

describe("a conversation's words settling as it opens", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("leaves the conversation shown first as it is", () => {
    const { getByRole } = render(<Conversation id="a" lines={["Hello"]} />);

    expect(settling(getByRole("log"))).toBe(false);
  });

  it("settles another conversation's words once, then leaves them be", () => {
    const { getByRole, rerender } = render(
      <Conversation id="a" lines={["Hello"]} />,
    );

    rerender(<Conversation id="b" lines={["Another", "conversation"]} />);
    expect(settling(getByRole("log"))).toBe(true);

    act(() => vi.advanceTimersByTime(500));
    expect(settling(getByRole("log"))).toBe(false);
  });

  it("waits for words that arrive after the conversation is chosen", async () => {
    const { getByRole, rerender } = render(
      <Conversation id="a" lines={["Hello"]} />,
    );

    rerender(<Conversation id="b" lines={[]} />);
    act(() => vi.advanceTimersByTime(1000));
    expect(settling(getByRole("log"))).toBe(true);

    rerender(<Conversation id="b" lines={["Read from disk"]} />);
    // Their arrival is noticed as soon as the page is free to.
    await act(async () => {});
    act(() => vi.advanceTimersByTime(400));
    expect(settling(getByRole("log"))).toBe(true);
    act(() => vi.advanceTimersByTime(100));
    expect(settling(getByRole("log"))).toBe(false);
  });

  it("settles words that follow a notice shown while the conversation loads", async () => {
    const { getByRole, rerender } = render(
      <Conversation id="a" lines={["Hello"]} />,
    );

    rerender(<Conversation id="b" lines={["Opening…"]} />);
    act(() => vi.advanceTimersByTime(300));
    rerender(<Conversation id="b" lines={["Opening…", "Read from disk"]} />);
    await act(async () => {});
    act(() => vi.advanceTimersByTime(400));

    expect(settling(getByRole("log"))).toBe(true);
    act(() => vi.advanceTimersByTime(100));
    expect(settling(getByRole("log"))).toBe(false);
  });

  it("stops waiting for a conversation that has no words", () => {
    const { getByRole, rerender } = render(
      <Conversation id="a" lines={["Hello"]} />,
    );

    rerender(<Conversation id="b" lines={[]} />);
    act(() => vi.advanceTimersByTime(2000));

    expect(settling(getByRole("log"))).toBe(false);
  });
});
