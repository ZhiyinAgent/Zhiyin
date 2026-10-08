import { useRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReadingPosition } from "./readingPosition.js";

/**
 * jsdom has no layout, so the conversation is given one: messages that are
 * twice as tall when the column is narrow, which is what opening the browser
 * beside a conversation actually does to it.
 */
const messageCount = 12;
const wideHeight = 100;
let viewHeight = 300;
let extraHeight = 0;

let width = 1000;
let notify: (() => void) | undefined;

function heightOf(): number {
  return width < 500 ? wideHeight * 2 : wideHeight;
}

function layOut(container: HTMLElement): void {
  let scrollTop = 0;
  const contentHeight = () =>
    container.children.length * heightOf() + extraHeight;
  const measure = (element: Element, top: () => number) =>
    vi.spyOn(element, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          top: top(),
          bottom: top() + heightOf(),
          height: heightOf(),
          left: 0,
          right: width,
          width,
          x: 0,
          y: top(),
          toJSON: () => "",
        }) as DOMRect,
    );
  // Measured through the live child list, so a message arriving mid-turn is
  // laid out like the rest instead of falling outside the fixture.
  const place = (child: Element) =>
    measure(
      child,
      () => [...container.children].indexOf(child) * heightOf() - scrollTop,
    );
  measure(container, () => 0);
  [...container.children].forEach(place);
  new MutationObserver((records) =>
    records.forEach((record) =>
      record.addedNodes.forEach((node) => {
        if (node instanceof Element) place(node);
      }),
    ),
  ).observe(container, { childList: true });
  Object.defineProperty(container, "clientHeight", { get: () => viewHeight });
  Object.defineProperty(container, "clientWidth", { get: () => width });
  Object.defineProperty(container, "scrollHeight", { get: contentHeight });
  Object.defineProperty(container, "scrollTop", {
    get: () => scrollTop,
    // Clamped the way a real scroll container clamps it.
    set: (value: number) => {
      scrollTop = Math.max(0, Math.min(value, contentHeight() - viewHeight));
    },
  });
}

function Conversation({ count = messageCount }: { count?: number }) {
  const container = useRef<HTMLDivElement>(null);
  useReadingPosition(container);
  return (
    <div data-testid="conversation" ref={container}>
      {Array.from({ length: count }, (_, index) => (
        <p key={index}>Message {index}</p>
      ))}
    </div>
  );
}

/** The window shows a placeholder until the app has loaded, then the conversation. */
function LoadedLater({
  loading,
  count = messageCount,
}: {
  loading: boolean;
  count?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  useReadingPosition(container);
  if (loading) return <p>Loading</p>;
  return (
    <div data-testid="conversation" ref={container}>
      {Array.from({ length: count }, (_, index) => (
        <p key={index}>Message {index}</p>
      ))}
    </div>
  );
}

/** Lets the conversation's observers act on what just changed. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Reports the width the fixture gave the column, so later reports are heights. */
function settleWidth(): void {
  notify?.();
}

function narrowTheColumn(): void {
  width = 400;
  notify?.();
}

afterEach(() => {
  width = 1000;
  viewHeight = 300;
  extraHeight = 0;
  notify = undefined;
  vi.restoreAllMocks();
});

describe("the place someone is reading", () => {
  beforeEach(installResizeReporting);

  it("keeps the message they were reading in view when the column narrows", () => {
    render(<Conversation />);
    const conversation = screen.getByTestId("conversation");
    layOut(conversation);
    settleWidth();

    // Reading the fifth message, at the top of the view.
    fireEvent.wheel(conversation, { deltaY: -300 });
    conversation.scrollTop = 4 * wideHeight;
    fireEvent.scroll(conversation);
    narrowTheColumn();

    // The messages are twice as tall now, so the same message begins twice as
    // far down the conversation — and that is where the view is.
    expect(conversation.scrollTop).toBe(4 * wideHeight * 2);
  });

  it("keeps someone who was at the end of the conversation at the end", () => {
    render(<Conversation />);
    const conversation = screen.getByTestId("conversation");
    layOut(conversation);

    conversation.scrollTop = messageCount * wideHeight - viewHeight;
    fireEvent.scroll(conversation);
    narrowTheColumn();

    expect(conversation.scrollTop).toBe(
      messageCount * wideHeight * 2 - viewHeight,
    );
  });

  it("keeps the end of the conversation in view when anything new arrives", async () => {
    const { rerender } = render(<Conversation />);
    const conversation = screen.getByTestId("conversation");
    layOut(conversation);

    conversation.scrollTop = messageCount * wideHeight;
    fireEvent.scroll(conversation);

    // Not a message: an action, a tool call, an approval — the conversation
    // grows for reasons other than someone typing.
    rerender(<Conversation count={messageCount + 1} />);

    await waitFor(() =>
      expect(conversation.scrollTop).toBe(
        (messageCount + 1) * wideHeight - viewHeight,
      ),
    );
  });

  it("keeps the end in view in a conversation shown after the app has loaded", async () => {
    const { rerender } = render(<LoadedLater loading />);
    rerender(<LoadedLater loading={false} />);
    const conversation = screen.getByTestId("conversation");
    layOut(conversation);

    conversation.scrollTop = messageCount * wideHeight;
    fireEvent.scroll(conversation);
    // An action arrives: no message changes, only the conversation grows.
    rerender(<LoadedLater loading={false} count={messageCount + 1} />);

    await waitFor(() =>
      expect(conversation.scrollTop).toBe(
        (messageCount + 1) * wideHeight - viewHeight,
      ),
    );
  });

  it("keeps the end in view when a call already shown grows taller", () => {
    render(<Conversation />);
    const conversation = screen.getByTestId("conversation");
    layOut(conversation);
    settleWidth();

    conversation.scrollTop = messageCount * wideHeight;
    fireEvent.scroll(conversation);

    // Nothing is added: a card that was already there finishes loading its
    // details, and no change to the page's structure says so.
    extraHeight = 240;
    notify?.();

    expect(conversation.scrollTop).toBe(
      messageCount * wideHeight + 240 - viewHeight,
    );
  });

  it("keeps the end in view when the space below the conversation takes room", () => {
    render(<Conversation />);
    const conversation = screen.getByTestId("conversation");
    layOut(conversation);
    settleWidth();

    conversation.scrollTop = messageCount * wideHeight;
    fireEvent.scroll(conversation);

    // A question or an approval appears under the conversation and the view
    // gets shorter, without any scrolling by the person.
    viewHeight = 150;
    notify?.();

    expect(conversation.scrollTop).toBe(messageCount * wideHeight - 150);
  });

  it("keeps following when something grows before the scroll a follow caused arrives", async () => {
    const { rerender } = render(<Conversation />);
    const conversation = screen.getByTestId("conversation");
    layOut(conversation);
    settleWidth();
    conversation.scrollTop = messageCount * wideHeight;
    fireEvent.scroll(conversation);

    // A picture in a card finishes decoding: the conversation is taller, and
    // the scroll event the browser owes for the last follow reports a view
    // far from the end. Nobody scrolled.
    extraHeight = 400;
    fireEvent.scroll(conversation);
    rerender(<Conversation count={messageCount + 1} />);

    await waitFor(() =>
      expect(conversation.scrollTop).toBe(
        (messageCount + 1) * wideHeight + 400 - viewHeight,
      ),
    );
  });

  it("keeps following when the browser moves the view to hold its place", async () => {
    const { rerender } = render(<Conversation />);
    const conversation = screen.getByTestId("conversation");
    layOut(conversation);
    conversation.scrollTop = messageCount * wideHeight;
    fireEvent.scroll(conversation);

    // Messages above the view rewrap after the browser opens beside them, and
    // the browser shifts the view to keep what was showing in place. No wheel,
    // key or scrollbar was touched.
    conversation.scrollTop = messageCount * wideHeight - viewHeight - 130;
    fireEvent.scroll(conversation);
    rerender(<Conversation count={messageCount + 1} />);

    await waitFor(() =>
      expect(conversation.scrollTop).toBe(
        (messageCount + 1) * wideHeight - viewHeight,
      ),
    );
  });

  it("stops following only when the person moves the view away from the end", async () => {
    const { rerender } = render(<Conversation />);
    const conversation = screen.getByTestId("conversation");
    layOut(conversation);
    conversation.scrollTop = messageCount * wideHeight;
    fireEvent.scroll(conversation);

    fireEvent.wheel(conversation, { deltaY: -900 });
    conversation.scrollTop = 3 * wideHeight;
    fireEvent.scroll(conversation);
    rerender(<Conversation count={messageCount + 1} />);
    await nextTask();

    expect(conversation.scrollTop).toBe(3 * wideHeight);
  });

  it("stops following when the person pages up with the keyboard", async () => {
    const { rerender } = render(<Conversation />);
    const conversation = screen.getByTestId("conversation");
    layOut(conversation);
    conversation.scrollTop = messageCount * wideHeight;
    fireEvent.scroll(conversation);

    fireEvent.keyDown(conversation, { key: "PageUp" });
    conversation.scrollTop = 6 * wideHeight;
    fireEvent.scroll(conversation);
    rerender(<Conversation count={messageCount + 1} />);
    await nextTask();

    expect(conversation.scrollTop).toBe(6 * wideHeight);
  });

  it("stops following when the person drags the scrollbar up", async () => {
    const { rerender } = render(<Conversation />);
    const conversation = screen.getByTestId("conversation");
    layOut(conversation);
    conversation.scrollTop = messageCount * wideHeight;
    fireEvent.scroll(conversation);

    // Held for longer than a wheel's moment: the drag is still theirs.
    const later = performance.now() + 60_000;
    vi.spyOn(performance, "now").mockReturnValue(later);
    fireEvent.pointerDown(conversation);
    conversation.scrollTop = 2 * wideHeight;
    fireEvent.scroll(conversation);
    fireEvent.pointerUp(window);
    rerender(<Conversation count={messageCount + 1} />);
    await nextTask();

    expect(conversation.scrollTop).toBe(2 * wideHeight);
  });

  it("does not follow growth once someone has scrolled up", () => {
    render(<Conversation />);
    const conversation = screen.getByTestId("conversation");
    layOut(conversation);
    settleWidth();

    fireEvent.wheel(conversation, { deltaY: -300 });
    conversation.scrollTop = 2 * wideHeight;
    fireEvent.scroll(conversation);
    extraHeight = 240;
    notify?.();

    expect(conversation.scrollTop).toBe(2 * wideHeight);
  });

  it("does not pull someone who has scrolled up back to the end", async () => {
    const { rerender } = render(<Conversation />);
    const conversation = screen.getByTestId("conversation");
    layOut(conversation);

    fireEvent.wheel(conversation, { deltaY: -300 });
    conversation.scrollTop = 2 * wideHeight;
    fireEvent.scroll(conversation);
    rerender(<Conversation count={messageCount + 1} />);

    await waitFor(() => expect(conversation.scrollTop).toBe(2 * wideHeight));
  });

  it("leaves the position alone when only the height changes", () => {
    render(<Conversation />);
    const conversation = screen.getByTestId("conversation");
    layOut(conversation);

    fireEvent.wheel(conversation, { deltaY: -300 });
    conversation.scrollTop = 4 * wideHeight;
    fireEvent.scroll(conversation);
    notify?.();

    expect(conversation.scrollTop).toBe(4 * wideHeight);
  });
});

/** A stand-in for the browser's resize reporting, which jsdom does not have. */
function installResizeReporting(): void {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      #callback: () => void;
      constructor(callback: () => void) {
        this.#callback = callback;
      }
      observe() {
        notify = () => this.#callback();
      }
      disconnect() {
        notify = undefined;
      }
      unobserve() {}
    },
  );
}
