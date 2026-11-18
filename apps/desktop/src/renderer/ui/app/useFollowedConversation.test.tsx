import { useRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingUserInputRequest } from "@zhiyin/contract";
import { UserInputPrompt } from "../user-input/index.js";
import { useFollowedConversation } from "./useFollowedConversation.js";

const quiz: PendingUserInputRequest = {
  id: "quiz-7",
  kind: "quiz",
  title: "Institutions de la Ve République",
  questions: [
    {
      id: "president",
      prompt: "Qui nomme le Premier ministre ?",
      answers: [
        { id: "president", label: "Le Président" },
        { id: "assembly", label: "L'Assemblée nationale" },
      ],
      selection: "single",
      correctAnswerIds: ["president"],
      explanation: "La nomination relève des pouvoirs propres du Président.",
    },
  ],
};

const messages = [
  { sequence: 0, id: "earlier", role: "assistant", text: "Bonjour" },
  { sequence: 1, id: "reply", role: "assistant", text: "Prêt ?" },
  { sequence: 2, id: "ask", role: "user", text: "Quiz me" },
] as const;

/** The conversation's thread, as the shell draws it: messages, then the question. */
function Thread({ asking }: { asking: boolean }) {
  const thread = useRef<HTMLDivElement>(null);
  useFollowedConversation(thread, {
    conversationId: "task-1",
    task: {
      messages,
      phase: asking
        ? { kind: "input", steps: [], prompt: quiz }
        : { kind: "working", steps: [] },
    },
    compact: false,
  });
  return (
    <div data-testid="thread" ref={thread}>
      {messages.map((message) => (
        <p key={message.id}>{message.text}</p>
      ))}
      {asking && (
        <div>
          <UserInputPrompt
            prompt={quiz}
            onSubmit={() => undefined}
            onCancel={() => undefined}
          />
        </div>
      )}
    </div>
  );
}

/**
 * jsdom has no layout, so the thread is given one: each message 100 pixels
 * tall, the question as tall as `questionHeight`, in a view `viewHeight`
 * tall that scrolls as a real one does.
 */
let viewHeight = 400;
let questionHeight = 300;
let scrollTop = 0;
const messageHeight = 100;

function thread(): HTMLElement {
  return screen.getByTestId("thread");
}

function heightOf(entry: Element): number {
  return entry.querySelector('[aria-label="Quiz"]')
    ? questionHeight
    : messageHeight;
}

function contentHeight(): number {
  return [...thread().children].reduce(
    (sum, entry) => sum + heightOf(entry),
    0,
  );
}

/** Where an element sits relative to the top of the view. */
function placeOf(element: Element): { top: number; height: number } {
  const scroller = thread();
  if (element === scroller) return { top: 0, height: viewHeight };
  let top = -scrollTop;
  for (const entry of scroller.children) {
    if (entry.contains(element)) return { top, height: heightOf(entry) };
    top += heightOf(entry);
  }
  return { top: 0, height: 0 };
}

function layOut(): void {
  const scroller = thread();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const { top, height } = placeOf(this);
      return {
        top,
        bottom: top + height,
        height,
        left: 0,
        right: 800,
        width: 800,
        x: 0,
        y: top,
        toJSON: () => "",
      } as DOMRect;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return placeOf(this).height;
    },
  );
  Object.defineProperty(scroller, "clientHeight", { get: () => viewHeight });
  Object.defineProperty(scroller, "clientWidth", { get: () => 800 });
  Object.defineProperty(scroller, "scrollHeight", { get: contentHeight });
  Object.defineProperty(scroller, "scrollTop", {
    get: () => scrollTop,
    // Clamped the way a real scroll container clamps it.
    set: (value: number) => {
      scrollTop = Math.max(0, Math.min(value, contentHeight() - viewHeight));
    },
  });
}

/** Every size watcher in the page, told that what it watches changed size. */
let sizeWatchers: (() => void)[] = [];

function reportSizes(): void {
  act(() => sizeWatchers.forEach((report) => report()));
}

function questionHeadingInView(): boolean {
  const heading = screen.getByRole("heading", {
    name: "Institutions de la Ve République",
  });
  const { top } = heading.getBoundingClientRect();
  return top >= 0 && top < viewHeight;
}

function endInView(): boolean {
  return scrollTop === contentHeight() - viewHeight;
}

/** Lets the conversation's observers act on what just changed. */
async function settle(): Promise<void> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

beforeEach(() => {
  sizeWatchers = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      #report: () => void;
      constructor(report: () => void) {
        this.#report = report;
      }
      observe() {
        if (!sizeWatchers.includes(this.#report))
          sizeWatchers.push(this.#report);
      }
      disconnect() {
        sizeWatchers = sizeWatchers.filter((report) => report !== this.#report);
      }
      unobserve() {}
    },
  );
});

afterEach(() => {
  viewHeight = 400;
  questionHeight = 300;
  scrollTop = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("a question in the conversation", () => {
  it("is shown from its heading when it turns out taller than the view once drawn", async () => {
    const { rerender } = render(<Thread asking={false} />);
    layOut();
    // Off screen, the question is first laid out at a stand-in height that fits.
    questionHeight = 160;
    rerender(<Thread asking />);
    await settle();

    questionHeight = 446;
    reportSizes();
    await settle();

    expect(questionHeadingInView()).toBe(true);
  });

  it("is shown from its heading when the window gets too short for it", async () => {
    const { rerender } = render(<Thread asking={false} />);
    layOut();
    rerender(<Thread asking />);
    await settle();
    expect(endInView()).toBe(true);

    viewHeight = 250;
    reportSizes();
    await settle();

    expect(questionHeadingInView()).toBe(true);
  });

  it("stays where the person is once they act on it", async () => {
    const { rerender } = render(<Thread asking={false} />);
    layOut();
    rerender(<Thread asking />);
    await settle();

    fireEvent.pointerDown(screen.getByRole("radio", { name: "Le Président" }));
    // Checking the answer adds its explanation below.
    questionHeight = 446;
    reportSizes();
    await settle();

    expect(endInView()).toBe(true);
  });
});
