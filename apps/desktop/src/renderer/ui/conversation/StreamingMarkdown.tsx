import { useEffect, useState } from "react";
import { MarkdownMessage } from "./MarkdownMessage.js";

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
 */
export function StreamingMarkdown({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  return <MarkdownMessage>{useSmoothText(text, streaming)}</MarkdownMessage>;
}

/** How far behind what has arrived the reveal is ever allowed to fall. */
const catchUpMs = 140;
/** Never slower than this, so a long backlog cannot crawl. */
const minimumCharactersPerFrame = 2;
const assumedFrameMs = 16;

export function useSmoothText(target: string, streaming: boolean): string {
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
