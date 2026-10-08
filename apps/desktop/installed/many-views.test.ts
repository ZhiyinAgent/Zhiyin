/**
 * A real model drawing several views in the installed app.
 *
 * A turn that writes several long chart and diagram specifications should not
 * leave the window looking frozen until they all appear at once. Two things are
 * watched. That the window is told what is being composed while the call is
 * still arriving. And that the thread which draws is not held long enough to
 * feel frozen while it happens, including during the view validation each
 * drawing goes through, which runs Mermaid's parser on that same thread.
 *
 * Skipped without a credential, and never given one by default: it costs money
 * and needs a network, so the gate does not run it. Run it deliberately:
 *
 *   $env:OPENROUTER_API_KEY = "..."; npx vitest run --project installed many-views
 */

import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { emptyConversationLists } from "@zhiyin/contract";
import type { SavedWorkspace } from "@zhiyin/session";
import {
  chooseModel,
  closeEverything,
  launch,
  plantHistory,
  temporaryDataDirectory,
} from "./launch.js";

const record = join(tmpdir(), "zhiyin-many-views.json");

const key = process.env["OPENROUTER_API_KEY"];

afterEach(closeEverything);

const oneConversation = JSON.stringify({
  preferences: { onboarded: true, interests: ["analysis"] },
  recentWorkspaces: [],
  selectedTaskId: "t1",
  tasks: [
    {
      ...emptyConversationLists,
      id: "t1",
      title: "Draw the picture",
      titleSource: "generated",
      updatedAt: "2026-09-14T09:00:00.000Z",
      updatedLabel: "Now",
      messages: [],
      phase: { kind: "draft" },
    },
  ],
} satisfies SavedWorkspace);

/** Several drawings, each with a long argument. */
const askedFor = [
  "Draw three separate diagrams with render_diagram, and two charts with",
  "render_bar_chart, describing how a support request moves from arriving to",
  "being resolved. Give each chart at least twelve data points with long,",
  "descriptive labels. Do not summarise first — draw them.",
].join(" ");

describe.skipIf(!key)("a live turn that draws several views", () => {
  it(
    "says what it is composing, and keeps the window responsive while it does",
    { timeout: 240_000 },
    async () => {
      const dataDirectory = await temporaryDataDirectory();
      await plantHistory(dataDirectory, oneConversation);
      await chooseModel(dataDirectory);
      const launched = await launch({
        dataDirectory,
        ...(key ? { apiKey: key } : {}),
      });
      const { window } = launched;

      await window
        .getByText("Draw the picture")
        .first()
        .waitFor({ state: "visible", timeout: 60_000 });

      await window.evaluate(() => {
        const stalls: number[] = [];
        (window as unknown as { stalls: number[] }).stalls = stalls;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) stalls.push(entry.duration);
        }).observe({ type: "longtask", buffered: true });
      });

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
       * Polled from here rather than watched from inside the page. A page-side
       * observer scanning the document on every mutation would hold the very
       * thread this is measuring, and report the cost of the measurement as the
       * defect.
       */
      const composing = new Set<string>();
      let views = 0;
      const until = Date.now() + 150_000;
      while (Date.now() < until) {
        const seen = await window.evaluate(() => {
          // The note's own element, not a slice of the page's text: element
          // boundaries leave no gap in `textContent`, so matching across the
          // document picks up whatever happens to be drawn next to it.
          const note = [...document.querySelectorAll('[role="status"]')]
            .map((node) => node.textContent?.trim() ?? "")
            .find((text) => text.startsWith("Composing a request"));
          return {
            note,
            views: document.querySelectorAll(
              '[data-diagram], section[aria-label$=" view"]',
            ).length,
          };
        });
        if (seen.note) composing.add(seen.note);
        views = Math.max(views, seen.views);
        // Enough of the turn has happened to judge it.
        if (views >= 3 && composing.size > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

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
          {
            composing: [...composing],
            views,
            ...measured,
            elapsedMs: elapsed,
          },
          null,
          2,
        ),
        "utf8",
      );

      expect({
        saidWhatItWasComposing: composing.size > 0,
        drewSomething: views > 0,
        worstUnder400ms: measured.worstMs < 400,
      }).toMatchObject({
        saidWhatItWasComposing: true,
        drewSomething: true,
        worstUnder400ms: true,
      });
    },
  );
});
