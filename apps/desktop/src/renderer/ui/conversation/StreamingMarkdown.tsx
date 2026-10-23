import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  MarkdownBlocks,
  MarkdownMessage,
  type BlockStarts,
} from "./MarkdownMessage.js";

/**
 * The model's answer as it arrives, paced so it reads rather than flickers.
 *
 * Text does not come off the network evenly. It comes in bursts — a stalled
 * moment, then forty tokens at once — and drawn as it lands that looks like
 * the app stuttering rather than like something being written. This reveals
 * what has arrived at a steady rate instead, always catching up: the backlog
 * is cleared within a fixed span, so the pacing never becomes a delay. When
 * the turn ends, everything remaining is shown at once, because a finished
 * answer must never be left partly drawn.
 *
 * Anything that is not an extension of what is already there — a different
 * message, or a rewrite — appears whole. Animating between two unrelated texts
 * would be a lie about what happened.
 *
 * Once it has streamed, a block the answer has finished is not read again:
 * each step reads only the blocks still open at its end. A finished answer
 * keeps what was drawn while it streamed.
 */
export function StreamingMarkdown({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const shown = useSmoothText(text, streaming);
  const [streamed, setStreamed] = useState(streaming);
  if (streaming && !streamed) setStreamed(true);
  const blocks = useFinishedBlocks(shown);
  return streamed ? (
    <MarkdownBlocks blocks={blocks.parts} onLastBlocks={blocks.read} />
  ) : (
    <MarkdownMessage>{shown}</MarkdownMessage>
  );
}

/** The blocks of an answer that can no longer change. */
type Finished = {
  readonly blocks: readonly string[];
  /** The text they span. */
  readonly text: string;
  /** The answer they were found in, which they hold for while it only grows. */
  readonly within: string;
  /**
   * Whether the answer is read whole: one that defines a link or a note can
   * change any block before the definition.
   */
  readonly whole: boolean;
};

const nothingFinished: Finished = {
  blocks: [],
  text: "",
  within: "",
  whole: false,
};

/**
 * The answer as blocks already finished and the rest, from where the markdown
 * reader found its blocks to start. Only a block with two more after it is
 * finished: the last can still grow, and the one before it can still be
 * joined by it, as a paragraph "10" that becomes "10." joins the list above.
 * The answer is cut only before a block that reads the same with nothing
 * before it, since what follows is read alone.
 */
function useFinishedBlocks(text: string): {
  readonly parts: readonly string[];
  readonly read: BlockStarts;
} {
  const [finished, setFinished] = useState(nothingFinished);
  const kept = text.startsWith(finished.within) ? finished : nothingFinished;
  const rest = text.slice(kept.text.length);
  const seen = useRef<{
    text: string;
    read: Parameters<BlockStarts>[0];
  }>(undefined);
  const read = useCallback<BlockStarts>(
    (read) => {
      seen.current = { text: rest, read };
    },
    [rest],
  );
  useLayoutEffect(() => {
    const last = seen.current;
    // Read from what the reader said, as a size is read from the layout.
    if (kept.whole || last?.text !== rest) return;
    const { starts, readsAlone, defines } = last.read;
    if (defines) {
      setFinished({ ...nothingFinished, within: text, whole: true });
      return;
    }
    // Cut where a block's line starts, only before one that reads the same
    // with nothing before it.
    const cuts = starts.filter(
      (_, index) => index < starts.length - 1 && readsAlone[index],
    );
    if (!cuts.length) return;
    const blocks = cuts.map((cut, index) =>
      rest.slice(index ? cuts[index - 1] : 0, cut),
    );
    setFinished({
      blocks: [...kept.blocks, ...blocks],
      text: kept.text + rest.slice(0, cuts.at(-1)),
      within: kept.text + last.text,
      whole: false,
    });
  }, [kept, rest, text]);
  return { parts: [...kept.blocks, rest], read };
}

/** How far behind what has arrived the reveal is ever allowed to fall. */
const catchUpMs = 140;
/** Never slower than this, so a long backlog cannot crawl. */
const minimumCharactersPerFrame = 2;
const assumedFrameMs = 16;

function useSmoothText(target: string, streaming: boolean): string {
  const [reveal, setReveal] = useState({
    text: target,
    length: target.length,
  });

  // Adjusted while rendering rather than in an effect: this is state derived
  // from a prop, and deriving it a frame later would draw the previous
  // message's text under the new one for that frame. React supports setting
  // state during render of the same component for exactly this.
  if (reveal.text !== target) {
    const continues = target.startsWith(reveal.text);
    setReveal({
      text: target,
      length:
        !streaming || !continues
          ? target.length
          : Math.min(reveal.length, target.length),
    });
  } else if (!streaming && reveal.length < target.length) {
    // The turn ended without another token: the same text stops being a
    // stream and becomes an answer, and an answer is never left half drawn.
    setReveal({ text: target, length: target.length });
  }

  const { length } = reveal;
  useEffect(() => {
    if (!streaming || length >= target.length) return;
    const frame = requestAnimationFrame(() => {
      const behind = target.length - length;
      setReveal({
        text: target,
        length: Math.min(
          target.length,
          length +
            Math.max(
              minimumCharactersPerFrame,
              Math.ceil((behind * assumedFrameMs) / catchUpMs),
            ),
        ),
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [target, streaming, length]);

  return target.slice(0, Math.min(length, target.length));
}
