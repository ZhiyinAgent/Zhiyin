/**
 * A long answer while it streams. Each reveal step draws a few more
 * characters; the blocks before them are already drawn and are not read
 * again, so in an answer of many blocks a step at the end costs about what one
 * at the start did. At every point the answer looks exactly as the same text
 * does once finished, and finishing keeps what was drawn.
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownMessage } from "./MarkdownMessage.js";
import { StreamingMarkdown } from "./StreamingMarkdown.js";

let frames: FrameRequestCallback[] = [];

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

/** An answer as models write one: headings, lists, a table, code, links. */
const section = (index: number) => `## Part ${index}

The figures for region ${index} rose in the third quarter, led by **online
orders** and a [revised price list](https://example.com/prices/${index}).

1. Orders grew by ${index}%.

2. Returns fell, with one caveat:

   the October count is provisional.

- Tight item one
- Tight item two
  - Nested item

> Quoted from the regional summary,
> second line.

| Region | Change |
| --- | --- |
| North | +${index}% |

\`\`\`python
total = 0

if rows[0]:
    pass

for row in rows:
    total += row.value
\`\`\`

    indented code after a blank line

A closing paragraph with \`inline code\` and an autolink https://example.com/${index}.

---

`;

const answer = (length: number) => {
  let text = "";
  for (let index = 1; text.length < length; index += 1) text += section(index);
  return text.slice(0, length);
};

/** What the finished answer would draw for this much of the text. */
function finishedHtml(text: string): string {
  const { container, unmount } = render(
    <MarkdownMessage>{text}</MarkdownMessage>,
  );
  const html = container.innerHTML;
  unmount();
  return html;
}

/**
 * Streams the text into one answer, `step` characters at a time, and says at
 * which point, if any, it looked different from the finished answer of the
 * same text.
 */
function firstDifference(text: string, step: number): string | undefined {
  let shown = text.slice(0, step);
  const view = render(<StreamingMarkdown text={shown} streaming />);
  try {
    for (;;) {
      // Revealed in full before it is compared.
      while (frames.length) {
        const pending = frames;
        frames = [];
        act(() => pending.forEach((frame) => frame(0)));
      }
      const finished = finishedHtml(shown);
      if (view.container.innerHTML !== finished)
        return `at ${shown.length}: ${JSON.stringify(shown.slice(-40))}\n${view.container.innerHTML}\n${finished}`;
      if (shown.length === text.length) return undefined;
      shown = text.slice(0, shown.length + step);
      view.rerender(<StreamingMarkdown text={shown} streaming />);
    }
  } finally {
    view.unmount();
  }
}

describe("a streaming answer", () => {
  it("looks at every point exactly as the same text does once finished", () => {
    expect(firstDifference(answer(4_000), 37)).toBeUndefined();
  });

  it("looks at every character as finished, through fences, lists and quotes that span blank lines", () => {
    const tricky = `Intro line.

~~~md
Inside a fence.

# not a heading

\`\`\`
still inside

margin text still inside
~~~~

\`\`\`\`
four-mark fence
\`\`\`

margin text in the four-mark fence
\`\`\`\`

<pre>
kept

as it is
</pre>

<!--
a comment

that runs on
-->

- item with code:

  \`\`\`
  first

  last
  \`\`\`

- second item

  continued paragraph
2) a different list
3) its next item

> quote

> another quote
Lazy line.

    code block

* * *
- - -
Setext heading
===
1. one
10. ten

+1 for this

<div>
html

</div>
After.
`;
    expect(firstDifference(tricky, 1)).toBeUndefined();
  });

  it.each([
    [
      "a list item's code closed at the margin",
      "1. Install it:\n   ```bash\n   npm install\n```\n\nThen run the tests.\n\nAnd more.\n",
    ],
    [
      "a list that goes on after a paragraph that became one of its items",
      "1. First.\n\n10. Tenth.\n\nAfter.\n\nMore.\n",
    ],
    [
      "an XML declaration across a blank line",
      '<?xml version="1.0"\n\nencoding?>\n\nAfter.\n\nMore.\n',
    ],
    [
      "character data across a blank line",
      "<![CDATA[\n\nraw\n]]>\n\nAfter.\n\nMore.\n",
    ],
    [
      "a heading made of the line under a paragraph",
      "Intro.\n\nTitle\n---\n\nText.\n\nMore.\n",
    ],
    [
      "a bare number and dot after indented code",
      "\tcode\n\n10.\n+ p\n\nX\n\nY\n",
    ],
    [
      "indented code after a list",
      "   - indented\n\n\tcode\n\n\tc\n\nX\n\nY\n",
    ],
    [
      "an empty item after code after a list",
      "  1. indented\n\n\tcode\n+\n\nX\n\nY\n",
    ],
    ["an indented fence", "Para.\n\n   ```\n   code\n   ```\n\nX\n\nY\n\nZ\n"],
    [
      "an indented fence with deeper lines",
      "Para.\n\n  ```\n  code\n    deeper\n  ```\n\nX\n\nY\n",
    ],
    [
      "an indented list and a paragraph after it",
      "Para.\n\n   - item\n\n  more\n\nX\n\nY\n\nZ\n",
    ],
    ["an indented numbered list", "Para.\n\n  1. item\n\n   more\n\nX\n\nY\n"],
    [
      "an indented list and a line indented past it",
      "Then run:\n\n   - item\n\n       not code\n\nX\n\nY\n\nZ\n",
    ],
    [
      "a link defined under a label on two lines",
      "See [foo\nbar].\n\nX\n\nY\n\n[foo\nbar]: https://example.com\n",
    ],
    [
      "a link defined under a label with a bracket in it",
      "See [a\\]b].\n\nX\n\nY\n\n[a\\]b]: https://example.com\n",
    ],
    [
      "a note defined inside a list",
      "See it.[^n]\n\nX\n\nY\n\n- [^n]: The note.\n",
    ],
  ])("looks at every character as finished, with %s", (_, text) => {
    expect(firstDifference(text, 1)).toBeUndefined();
  });

  it("draws a rewrite as it reads, even where it keeps the start of what was there", () => {
    const view = render(
      <StreamingMarkdown text={"# A\nB\n# C\nd\n# E\nf"} streaming />,
    );
    // The line under "d" makes it a heading.
    const rewrite = "# A\nB\n# C\nd\n===\n";

    view.rerender(<StreamingMarkdown text={rewrite} streaming />);

    expect(view.container.innerHTML).toBe(finishedHtml(rewrite));
  });

  it("ends as the finished answer does, after streaming an indented block", () => {
    const text = "Para.\n\n   ```\n   code\n   ```\n\nX\n\nY\n\nZ\n";
    let shown = "";
    const view = render(<StreamingMarkdown text="" streaming />);
    for (const character of text) {
      shown += character;
      view.rerender(<StreamingMarkdown text={shown} streaming />);
    }

    view.rerender(<StreamingMarkdown text={text} streaming={false} />);

    expect(view.container.innerHTML).toBe(finishedHtml(text));
  });

  it("keeps what it drew when it finishes, so a selection in it stays", () => {
    const text =
      "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n\nFourth";
    const view = render(<StreamingMarkdown text={text} streaming />);
    const first = screen.getByText("First paragraph.");
    const selection = window.getSelection()!;
    selection.selectAllChildren(first);

    view.rerender(
      <StreamingMarkdown text={`${text} and last.`} streaming={false} />,
    );

    expect(screen.getByText("First paragraph.")).toBe(first);
    expect(selection.toString()).toBe("First paragraph.");
    expect(view.container.innerHTML).toBe(finishedHtml(`${text} and last.`));
  });

  it("looks the same as finished where the answer defines links or notes at its end", () => {
    const text = `See the [price list][prices] and the note.[^1]

More text.

[prices]: https://example.com/prices
[^1]: The October count is provisional.
`;
    expect(firstDifference(text, 1)).toBeUndefined();
  });

  it("reads at each step only what is new, not the whole answer again", () => {
    const start = answer(30_000);
    // The fastest of several runs: a busy machine only ever adds time, and it
    // adds it to both measures alike.
    const fastest = (times: readonly number[]) => Math.min(...times);

    const whole: number[] = [];
    for (let run = 0; run < 3; run += 1) {
      const began = performance.now();
      const view = render(<MarkdownMessage>{start}</MarkdownMessage>);
      whole.push(performance.now() - began);
      view.unmount();
    }

    const view = render(<StreamingMarkdown text={start} streaming />);
    const steps: number[] = [];
    let text = start;
    for (let step = 0; step < 12; step += 1) {
      text += " more words";
      view.rerender(<StreamingMarkdown text={text} streaming />);
      const pending = frames;
      frames = [];
      const began = performance.now();
      act(() => pending.forEach((frame) => frame(step)));
      steps.push(performance.now() - began);
    }
    view.unmount();

    // A step that read the whole answer again cost about as much as reading
    // it once.
    expect(fastest(steps)).toBeLessThan(fastest(whole) / 5);
  });
});
