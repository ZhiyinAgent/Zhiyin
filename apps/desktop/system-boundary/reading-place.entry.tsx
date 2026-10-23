/**
 * The page the reading-place test drives: the production conversation, in the
 * workspace's own scrolling column with the window's way of keeping a person's
 * place, and the application's stylesheets.
 */

import { useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "../src/renderer/styles.css";
import app from "../src/renderer/ui/app/app.module.css";
import {
  ConversationTimeline,
  type TimelineTask,
} from "../src/renderer/ui/conversation/ConversationTimeline.js";
import { useReadingPosition } from "../src/renderer/ui/conversation/readingPosition.js";

export type ReadingPlacePage = {
  /** Draws thirty exchanges, the first ten compacted when asked. */
  show(compacted: boolean): void;
  /** How far the message with this text starts below the column's top. */
  offsetOf(text: string): number;
  /** The text of the message at the top of the view, as far as it starts it. */
  topMessage(): string;
  /** Makes the column this wide, in pixels. */
  widen(width: number): void;
};

type Entry = { id: string; sequence: number };

const words =
  "The figures for the region rose in the third quarter, led by online orders and a revised price list, while returns fell. ";

function conversation(compacted: boolean): TimelineTask<Entry, Entry, Entry> {
  const messages = Array.from({ length: 30 }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 ? ("assistant" as const) : ("user" as const),
    text: `Message ${index}. ${words.repeat(index % 2 ? 4 : 1)}`,
    sequence: index,
  }));
  return {
    id: "reading",
    messages,
    actions: [],
    views: [],
    interactions: [],
    specialistRuns: [],
    condensings: [],
    plan: [],
    phase: { kind: "completed", outcome: { title: "Done", summary: "" } },
    ...(compacted ? { condensedThrough: "m9" } : {}),
  };
}

const pieces = {
  actions: () => null,
  view: () => null,
  interaction: () => null,
};

function Thread({ compacted }: { compacted: boolean }) {
  const column = useRef<HTMLDivElement>(null);
  useReadingPosition(column);
  return (
    <div
      id="view"
      className={app["thread-view"]}
      style={{ height: "600px", width: "900px" }}
    >
      {/* The browser's own anchoring off, so the window's is what is seen. */}
      <div
        id="column"
        ref={column}
        className={app["thread-scroll"]}
        style={{ overflowAnchor: "none" }}
      >
        <ConversationTimeline task={conversation(compacted)} pieces={pieces} />
      </div>
    </div>
  );
}

const stage = document.getElementById("stage")!;
const root = createRoot(stage);

const page: ReadingPlacePage = {
  show(compacted) {
    flushSync(() =>
      root.render(<Thread key={String(compacted)} compacted={compacted} />),
    );
  },
  offsetOf(text) {
    const column = document.getElementById("column")!;
    const message = [...column.querySelectorAll("p, div")].find((element) =>
      element.textContent?.startsWith(text),
    )!;
    return (
      message.getBoundingClientRect().top - column.getBoundingClientRect().top
    );
  },
  topMessage() {
    const column = document.getElementById("column")!;
    const top = column.getBoundingClientRect().top;
    const message = [
      ...column.querySelectorAll("article, [class*='user-turn']"),
    ].find((element) => element.getBoundingClientRect().bottom > top + 1)!;
    return message.textContent!.slice(0, 12);
  },
  widen(width) {
    document.getElementById("view")!.style.width = `${width}px`;
  },
};

(window as unknown as { readingPlace: ReadingPlacePage }).readingPlace = page;
