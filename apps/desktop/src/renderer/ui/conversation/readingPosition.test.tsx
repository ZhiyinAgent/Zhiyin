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
const viewHeight = 300;

let width = 1000;
let notify: (() => void) | undefined;

function heightOf(): number {
  return width < 500 ? wideHeight * 2 : wideHeight;
}

function layOut(container: HTMLElement): void {
  let scrollTop = 0;
  const contentHeight = () => container.children.length * heightOf();
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

function narrowTheColumn(): void {
  width = 400;
  notify?.();
}

afterEach(() => {
  width = 1000;
  notify = undefined;
  vi.restoreAllMocks();
});

describe("the place someone is reading", () => {
  beforeEach(installResizeReporting);

  it("keeps the message they were reading in view when the column narrows", () => {
    render(<Conversation />);
    const conversation = screen.getByTestId("conversation");
    layOut(conversation);

    // Reading the fifth message, at the top of the view.
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

  it("does not pull someone who has scrolled up back to the end", async () => {
    const { rerender } = render(<Conversation />);
    const conversation = screen.getByTestId("conversation");
    layOut(conversation);

    conversation.scrollTop = 2 * wideHeight;
    fireEvent.scroll(conversation);
    rerender(<Conversation count={messageCount + 1} />);

    await waitFor(() => expect(conversation.scrollTop).toBe(2 * wideHeight));
  });

  it("leaves the position alone when only the height changes", () => {
    render(<Conversation />);
    const conversation = screen.getByTestId("conversation");
    layOut(conversation);

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
