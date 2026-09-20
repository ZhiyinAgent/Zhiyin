/**
 * A long reasoning stream does not make the window stop responding.
 *
 * Every earlier measurement of this was taken against a fixture: a stream shaped
 * like a provider's, delivered as fast as the machine could manage. That covers
 * the parser and the loop and says nothing about what a person sees while a real
 * model reasons for a while — which is the thing that was reported.
 *
 * Skipped without a credential, and never given one by default: it costs money
 * and needs a network, so the gate does not run it. Run it deliberately:
 *
 *   $env:OPENROUTER_API_KEY = "..."; npx vitest run --project installed apps/desktop/installed/long-trace.test.ts
 */

import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import {
  closeEverything,
  launch,
  plantHistory,
  temporaryDataDirectory,
} from "./launch.js";

/**
 * Where the measurement is left behind.
 *
 * A run that only says "passed" records nothing worth quoting, and this one
 * costs a live model call — so the numbers outlive it, in a fixed place, for
 * whoever writes down what was measured.
 */
const record = join(tmpdir(), "zhiyin-long-trace.json");

const key = process.env["OPENROUTER_API_KEY"];

afterEach(closeEverything);

/** One conversation, selected, for the turn to happen in. */
const oneConversation = JSON.stringify({
  version: 1,
  preferences: { onboarded: true, interests: ["research"] },
  runtime: { tasks: "available", capabilities: "available" },
  selectedTaskId: "t1",
  tasks: [
    {
      id: "t1",
      title: "Think something through",
      titleSource: "generated",
      updatedAt: "2026-09-14T09:00:00.000Z",
      updatedLabel: "Now",
      messages: [],
      actions: [],
      phase: { kind: "draft" },
    },
  ],
  skills: [],
  subagents: [],
  mcpServers: [],
  usage: { status: "unavailable", reason: "None." },
});

/**
 * Something that takes a while to think about and produces a long answer, so the
 * stream is long for the reason this is about rather than because the model was
 * asked to pad.
 */
const askedFor = [
  "Work through this carefully and show your reasoning as you go.",
  "A team of six has to cover a support rota across five working days.",
  "Two people cannot work Mondays, one cannot work Fridays, and nobody may",
  "work two days in a row. Enumerate the constraints, check whether a valid",
  "rota exists, and if it does, give one and explain why it satisfies each",
  "constraint in turn.",
].join(" ");

describe.skipIf(!key)("a live reasoning stream in the installed app", () => {
  it(
    "keeps the window responsive while the model reasons at length",
    { timeout: 180_000 },
    async () => {
      const dataDirectory = await temporaryDataDirectory();
      await plantHistory(dataDirectory, oneConversation);
      const launched = await launch({
        dataDirectory,
        ...(key ? { apiKey: key } : {}),
      });
      const { window } = launched;

      await window
        .getByText("Think something through")
        .first()
        .waitFor({ state: "visible", timeout: 60_000 });

      /*
       * Every stall over 50ms on the thread that draws, collected while the
       * stream arrives. `buffered` so nothing is missed between the window
       * settling and this being installed.
       */
      await window.evaluate(() => {
        const stalls: number[] = [];
        (window as unknown as { stalls: number[] }).stalls = stalls;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) stalls.push(entry.duration);
        }).observe({ type: "longtask", buffered: true });
      });

      /*
       * Started, not waited for.
       *
       * `sendMessage` resolves when the whole turn is over, so awaiting it
       * makes this test as long as the turn and measures the wrong thing. What
       * is being measured is the window while the stream arrives, which is
       * happening well before the turn ends.
       */
      const startedAt = Date.now();
      await window.evaluate(
        ([taskId, message]) => {
          const bridge = (
            window as unknown as {
              zhiyin: {
                sendMessage(id: string, text: string): Promise<void>;
              };
            }
          ).zhiyin;
          void bridge
            .sendMessage(taskId as string, message as string)
            .catch(() => undefined);
        },
        ["t1", askedFor],
      );

      /*
       * The trace has to have actually arrived, or this measures nothing.
       *
       * Waited for as attached rather than visible: the trace opens itself
       * while it streams and closes again when the answer starts, so it can be
       * in the document and hidden by the time this is read. Hidden still has
       * its text, which is all that is wanted here.
       */
      const trace = window.getByLabel("Reasoning trace");
      await trace.waitFor({ state: "attached", timeout: 120_000 });

      // Sampled while it streams, until it stops growing or the window closes.
      // Long enough to catch a stall, short enough not to buy a whole answer.
      const streamingWindowMs = 45_000;
      const until = Date.now() + streamingWindowMs;
      let reasoned = 0;
      let unchanged = 0;
      while (Date.now() < until && unchanged < 10) {
        const now = await trace.evaluate(
          (node) => node.textContent?.length ?? 0,
        );
        unchanged = now > reasoned ? 0 : unchanged + 1;
        reasoned = Math.max(reasoned, now);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Stopped deliberately: the measurement is taken, and the rest of the
      // answer is somebody's money.
      await window
        .evaluate(
          (taskId) =>
            (
              window as unknown as {
                zhiyin: { interruptTask(id: string): Promise<void> };
              }
            ).zhiyin
              .interruptTask(taskId as string)
              .catch(() => undefined),
          "t1",
        )
        .catch(() => undefined);

      const measured = await window.evaluate(() => {
        const stalls = (window as unknown as { stalls: number[] }).stalls;
        return {
          stalls: stalls.length,
          worstMs: Math.round(Math.max(0, ...stalls)),
          totalMs: Math.round(stalls.reduce((sum, item) => sum + item, 0)),
        };
      });

      const elapsed = Date.now() - startedAt;

      await writeFile(
        record,
        JSON.stringify(
          { reasonedCharacters: reasoned, ...measured, elapsedMs: elapsed },
          null,
          2,
        ),
        "utf8",
      );

      expect({
        reasonedCharacters: reasoned,
        ...measured,
        elapsedMs: elapsed,
        // A stall long enough to be felt as the window having stopped. The
        // thresholds are the claim: anything under these is a window that kept
        // up, and a failure says by how much it did not.
        worstUnder400ms: measured.worstMs < 400,
        blockedUnderAFifthOfTheTime: measured.totalMs < elapsed / 5,
      }).toMatchObject({
        worstUnder400ms: true,
        blockedUnderAFifthOfTheTime: true,
      });
      expect(reasoned).toBeGreaterThan(200);
    },
  );
});
