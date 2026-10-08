// @vitest-environment node
/**
 * The production components, in a real browser, at the sizes a person uses.
 *
 * The component lab is built and served here, and driven with the
 * application's own browser. Nothing is restated: these are the same
 * components with the same stylesheets the application loads.
 *
 * It measures geometry, reachability and keyboard behaviour. It does not stand
 * in for a person looking at the screen, and it does not judge the design.
 */

import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import type { BrowserContext, Page } from "playwright-core";
import { build } from "vite";
import { playwrightBrowserLauncher } from "@zhiyin/interactive-browser";
import { openProcessContainer } from "@zhiyin/process-ownership";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const launcher = playwrightBrowserLauncher({ open: openProcessContainer });
const availability = await launcher.available();

const demo = fileURLToPath(new URL("../src/renderer/demo/", import.meta.url));

/** The window the app says it supports at its smallest, and a roomy desktop. */
const minimum = { width: 720, height: 480 };
const desktop = { width: 1100, height: 750 };

const contentTypes: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".html": "text/html",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

type Harness = { readonly url: string; close(): Promise<void> };

async function harness(): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "zhiyin-lab-review-"));
  await build({
    root: demo,
    base: "./",
    logLevel: "silent",
    plugins: [react()],
    build: {
      outDir: directory,
      emptyOutDir: true,
      // Both entries: the lab for components on their own, and the composed
      // workspace for the things that only exist once they are assembled — a
      // conversation long enough to scroll, for one.
      rollupOptions: {
        input: [
          join(demo, "component-lab.html"),
          join(demo, "zhiyin-demo.html"),
        ],
      },
    },
  });

  const server = createServer((request, response) => {
    const asked = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const path = asked === "/" ? "/component-lab.html" : asked;
    const file = normalize(join(directory, path));
    if (!resolve(file).startsWith(resolve(directory) + sep)) {
      response.writeHead(403).end();
      return;
    }
    // Opened before the headers go out, so a request for something nobody
    // served - a favicon, most reliably - can still be answered with a 404.
    const stream = createReadStream(file);
    stream.once("error", () => response.writeHead(404).end());
    stream.once("open", () => {
      response.writeHead(200, {
        "Content-Type":
          contentTypes[extname(file)] ?? "application/octet-stream",
      });
      stream.pipe(response);
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");

  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((done, fail) => {
        if (!server.listening) return done();
        server.close((error) => (error ? fail(error) : done()));
      });
      await rm(directory, { recursive: true, force: true });
    },
  };
}

/**
 * Waits for every diagram on the page to have finished drawing.
 *
 * This is the signal the card publishes for exactly this purpose. Waiting for
 * it is what makes a capture repeatable: a diagram arrives as a line of text
 * first and a drawing of a different size afterwards, so anything measured
 * before it settles is measuring the gap.
 */
async function diagramsSettled(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-diagram="drawing"]').length === 0 &&
      document.querySelectorAll("[data-diagram]").length > 0,
    undefined,
    { timeout: 60_000 },
  );
}

/**
 * Every drawn diagram, named by the lab section it sits in.
 *
 * Both the drawing's own coordinate system and the box it is painted into, so a
 * disagreement says which of the two moved: a changed `viewBox` is Mermaid
 * having laid the diagram out differently, while a changed box with the same
 * `viewBox` is the page around it.
 */
async function diagramSizes(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-diagram="drawn"]')].map(
      (element, index) => {
        const drawing = element.querySelector("svg");
        const box = drawing?.getBoundingClientRect();
        const section = element.closest("section[id]")?.id ?? "unknown";
        const viewBox = drawing?.getAttribute("viewBox") ?? "none";
        return `${section}#${index} viewBox=[${viewBox}] box=${Math.round(box?.width ?? 0)}x${Math.round(box?.height ?? 0)}`;
      },
    ),
  );
}

/**
 * Anything sticking out of the side of the window that a person cannot reach.
 *
 * Two things are deliberately not that. The shapes inside a drawing are the
 * drawing's own business — a diagram is allowed to be larger than its frame,
 * which is why the frame scrolls — so only the drawing's own box is asked
 * about. And anything inside something that scrolls sideways on purpose is
 * reachable by scrolling, which is the whole question.
 */
async function escapingHorizontally(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((element) => {
        if (element instanceof SVGElement && element.ownerSVGElement)
          return false;
        for (
          let parent = element.parentElement;
          parent;
          parent = parent.parentElement
        ) {
          const overflowX = getComputedStyle(parent).overflowX;
          if (overflowX === "auto" || overflowX === "scroll") return false;
        }
        const box = element.getBoundingClientRect();
        return (
          box.width > 0 && (box.right > window.innerWidth + 1 || box.left < -1)
        );
      })
      .slice(0, 12)
      .map((element) => {
        const classes =
          typeof element.className === "string" ? element.className : "";
        return `${element.tagName.toLowerCase()}.${classes.slice(0, 40)}`;
      }),
  );
}

describe.runIf(availability.available)(
  "the component lab in a real browser",
  () => {
    let served: Harness;

    beforeAll(async () => {
      served = await harness();
    }, 300_000);

    afterAll(async () => {
      await served?.close();
    });

    /**
     * Repeated captures of the lab's diagram sections agree at both supported
     * sizes. The drawing module on its own is measured separately; this is the
     * card as the application lays it out.
     */
    it("draws every diagram to the same size on repeated loads", async () => {
      const target = await launcher.launch(desktop);
      try {
        const page = (target.automation() as BrowserContext).pages()[0];
        if (!page) throw new Error("No browser page");

        for (const size of [desktop, minimum]) {
          await page.setViewportSize(size);
          const captures: string[][] = [];
          for (let load = 0; load < 4; load += 1) {
            await target.goto(served.url);
            await diagramsSettled(page);
            captures.push(await diagramSizes(page));
          }

          // Every load against the first, whole, so a disagreement names the
          // diagram and says whether its viewBox or its box moved.
          expect(captures[0]?.length ?? 0).toBeGreaterThan(0);
          expect({
            size: `${size.width}x${size.height}`,
            loads: captures.slice(1),
          }).toEqual({
            size: `${size.width}x${size.height}`,
            loads: [captures[0], captures[0], captures[0]],
          });
        }
      } finally {
        await target.close();
      }
    }, 300_000);

    /**
     * Nothing is left where a person cannot reach it at the smallest supported
     * window — counting a drawing's own box but not the shapes inside it, and
     * ignoring anything inside a container that scrolls sideways on purpose,
     * because scrolling is how that is reached.
     */
    it("keeps every component inside the minimum supported window", async () => {
      const target = await launcher.launch(minimum);
      try {
        const page = (target.automation() as BrowserContext).pages()[0];
        if (!page) throw new Error("No browser page");
        await page.setViewportSize(minimum);
        await target.goto(served.url);
        await diagramsSettled(page);

        expect(await escapingHorizontally(page)).toEqual([]);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(minimum.width + 1);
      } finally {
        await target.close();
      }
    }, 300_000);

    /**
     * A chart's text is the size the stylesheet sets, whatever the card's
     * width. A chart laid out at one width and scaled to the card would scale
     * its text too: 9px in a narrow card, 13px in a wide one.
     */
    it("draws chart text at 12px or more at the minimum window", async () => {
      const target = await launcher.launch(minimum);
      try {
        const page = (target.automation() as BrowserContext).pages()[0];
        if (!page) throw new Error("No browser page");
        await page.setViewportSize(minimum);
        await target.goto(served.url);
        await diagramsSettled(page);

        const sizes = await page.evaluate(() =>
          [...document.querySelectorAll('svg[role="img"] text')].map((text) => {
            const drawing = (text as SVGTextElement).ownerSVGElement!;
            const shown =
              drawing.getBoundingClientRect().width /
              drawing.viewBox.baseVal.width;
            return (
              Math.round(
                Number.parseFloat(getComputedStyle(text).fontSize) * shown * 10,
              ) / 10
            );
          }),
        );

        expect(sizes.length).toBeGreaterThan(0);
        expect(sizes.filter((size) => size < 12)).toEqual([]);
      } finally {
        await target.close();
      }
    }, 300_000);

    /**
     * A bar's name is written under it, and names are phrases: "Airport, both
     * ways" is wider than a bar in a card at the smallest window. Every name
     * stays clear of its neighbours' and inside its chart, as the browser
     * draws them.
     */
    it("keeps every bar's name clear of the next at the minimum window", async () => {
      const target = await launcher.launch(minimum);
      try {
        const page = (target.automation() as BrowserContext).pages()[0];
        if (!page) throw new Error("No browser page");
        await page.setViewportSize(minimum);
        await target.goto(`${served.url}#bar-chart-long-names`);
        await diagramsSettled(page);

        const names = await page.evaluate(() => {
          const drawing = document.querySelector(
            '#bar-chart-long-names svg[role="img"]',
          )!;
          const edge = drawing.getBoundingClientRect();
          return [...drawing.querySelectorAll("text")]
            .filter((text) => text.getAttribute("text-anchor") === "middle")
            .filter((text) => !text.getAttribute("transform"))
            .map((text) => {
              const box = text.getBoundingClientRect();
              return {
                name: text.textContent,
                left: box.left - edge.left,
                right: box.right - edge.left,
                top: box.top - edge.top,
                bottom: box.bottom - edge.top,
                width: edge.width,
                height: edge.height,
              };
            });
        });

        expect(names.map((name) => name.name)).toHaveLength(7);
        const crowded = names.flatMap((name, index) => {
          const next = names[index + 1];
          return next && name.right > next.left - 2
            ? [`${name.name} runs into ${next.name}`]
            : [];
        });
        expect(crowded).toEqual([]);
        const outside = names.filter(
          (name) =>
            name.left < 0 ||
            name.right > name.width ||
            name.bottom > name.height,
        );
        expect(outside).toEqual([]);
      } finally {
        await target.close();
      }
    }, 300_000);

    /**
     * A name is cut short only when it cannot fit: "Subscriptions" fits its
     * bar in a card at a roomy window, and is written whole.
     */
    it("writes a bar's name whole where it fits its bar", async () => {
      const target = await launcher.launch(desktop);
      try {
        const page = (target.automation() as BrowserContext).pages()[0];
        if (!page) throw new Error("No browser page");
        await page.setViewportSize(desktop);
        await target.goto(`${served.url}#bar-chart-spending`);
        await diagramsSettled(page);

        const names = await page.evaluate(() =>
          [
            ...document.querySelectorAll(
              '#bar-chart-spending svg[role="img"] text[text-anchor="middle"]',
            ),
          ]
            // A bar's name is drawn in lines; the axis names are not.
            .filter((text) => text.querySelector("tspan"))
            .map((text) =>
              [...text.querySelectorAll("tspan")]
                .map((line) => line.textContent)
                .join(" "),
            ),
        );

        expect(names).toEqual([
          "Housing",
          "Food",
          "Savings",
          "Transport",
          "Home & shopping",
          "Health",
          "Travel",
          "Subscriptions",
        ]);
      } finally {
        await target.close();
      }
    }, 300_000);

    it("keeps a selected clarification choice inside its option card in a real browser", async () => {
      const target = await launcher.launch(minimum);
      try {
        const page = (target.automation() as BrowserContext).pages()[0];
        if (!page) throw new Error("No browser page");
        await page.setViewportSize(minimum);
        await target.goto(`${served.url}#clarifying-questions`);

        const option = page
          .locator("#clarifying-questions label")
          .filter({ hasText: "Internal team" });
        const appearance = () =>
          option.evaluate((element) => {
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return {
              display: style.display,
              columns: style.gridTemplateColumns,
              padding: style.padding,
              radius: style.borderRadius,
              width: Math.round(box.width),
              height: Math.round(box.height),
              border: style.borderColor,
              background: style.backgroundColor,
            };
          });

        const before = await appearance();
        await option.click();
        await page.waitForTimeout(200);
        const after = await appearance();

        expect(before.display).toBe("grid");
        expect(before.width).toBeGreaterThan(0);
        expect(await option.locator("input").isChecked()).toBe(true);
        expect(after).toMatchObject({
          display: before.display,
          columns: before.columns,
          padding: before.padding,
          radius: before.radius,
          width: before.width,
          height: before.height,
        });
        expect([after.border, after.background]).not.toEqual([
          before.border,
          before.background,
        ]);
      } finally {
        await target.close();
      }
    }, 300_000);

    /*
     * A correct quiz answer is green, the app's colour for done, on both the
     * answered segment and the ticks the person made. It is one of the few
     * places success is marked, and the brand red would read as wrong there.
     * Both themes, whose greens differ.
     */
    it("marks a correct quiz answer in the app's green, never its red, in both themes", async () => {
      const target = await launcher.launch(desktop);
      try {
        const page = (target.automation() as BrowserContext).pages()[0];
        if (!page) throw new Error("No browser page");
        await page.setViewportSize(desktop);
        await target.goto(`${served.url}#quiz`);
        for (const scheme of ["dark", "light"] as const) {
          await page.emulateMedia({ colorScheme: scheme });
          await page.reload();
          const quiz = page.locator("#quiz");
          await quiz
            .getByRole("checkbox", {
              name: "Run the full gate, packaging included",
            })
            .check();
          await quiz
            .getByRole("checkbox", {
              name: "Exercise the installed app on a clean machine",
            })
            .check();
          await quiz.getByRole("button", { name: "Check answer" }).click();
          // The segment fades to its outcome. Read it once it is marked and no
          // fade is still running, however long the machine takes.
          await quiz.locator('[aria-label="Question 1: correct"]').waitFor();
          await page.waitForFunction(
            (root) =>
              !root
                ?.getAnimations({ subtree: true })
                .some((motion) => motion instanceof CSSTransition),
            await quiz.elementHandle(),
          );

          const seen = await quiz.evaluate((root) => {
            const token = (name: string) => {
              const probe = document.createElement("span");
              probe.style.color = `var(${name})`;
              root.append(probe);
              const colour = getComputedStyle(probe).color;
              probe.remove();
              return colour;
            };
            const segment = root.querySelector(
              '[aria-label="Question 1: correct"]',
            );
            return {
              green: token("--zy-green"),
              reds: ["--zy-accent", "--zy-accent-fill", "--zy-running"].map(
                token,
              ),
              segment: segment
                ? getComputedStyle(segment).backgroundColor
                : "no segment marked correct",
              ticks: [
                ...root.querySelectorAll<HTMLInputElement>("input:checked"),
              ].map((input) => getComputedStyle(input).accentColor),
            };
          });

          expect(seen.segment, scheme).toBe(seen.green);
          expect(seen.ticks, scheme).toEqual([seen.green, seen.green]);
          expect(seen.reds, scheme).not.toContain(seen.segment);
        }
      } finally {
        await target.close();
      }
    }, 300_000);

    /**
     * A diagram is the same size within and across motion settings. The
     * application's animations can change the label measurements Mermaid
     * takes, so drawing holds that motion still until measurement is complete.
     *
     * Captured twice in each setting rather than once, because one capture either
     * side cannot tell a setting apart from the navigation that carried it.
     */
    it("draws the same diagrams every time within one motion setting", async () => {
      const target = await launcher.launch(desktop);
      try {
        const page = (target.automation() as BrowserContext).pages()[0];
        if (!page) throw new Error("No browser page");
        await page.setViewportSize(desktop);

        const capture = async () => {
          await target.goto(served.url);
          await diagramsSettled(page);
          return diagramSizes(page);
        };

        await page.emulateMedia({ reducedMotion: "no-preference" });
        const ordinaryFirst = await capture();
        const ordinarySecond = await capture();

        await page.emulateMedia({ reducedMotion: "reduce" });
        const reducedFirst = await capture();
        const reducedSecond = await capture();

        expect({
          ordinaryIsStable:
            JSON.stringify(ordinaryFirst) === JSON.stringify(ordinarySecond),
          reducedIsStable:
            JSON.stringify(reducedFirst) === JSON.stringify(reducedSecond),
          settingsAgree:
            JSON.stringify(ordinaryFirst) === JSON.stringify(reducedFirst),
        }).toMatchObject({
          ordinaryIsStable: true,
          reducedIsStable: true,
          settingsAgree: true,
        });
      } finally {
        await target.close();
      }
    }, 300_000);

    /**
     * A diagram is zoomed and panned from the keyboard alone.
     *
     * The frame is reachable by tab, `+` and `-` change the zoom a person can
     * read back, and the arrows move the drawing inside it. None of this is
     * establishable in a DOM test: jsdom has no layout, so nothing scrolls and
     * a percentage that never became a width proves nothing.
     */
    it("zooms and pans a diagram from the keyboard", async () => {
      const target = await launcher.launch(desktop);
      try {
        const page = (target.automation() as BrowserContext).pages()[0];
        if (!page) throw new Error("No browser page");
        await page.setViewportSize(desktop);
        await target.goto(served.url);
        await diagramsSettled(page);

        const frame = page
          .locator('[role="region"][aria-label$="diagram"]')
          .first();
        await frame.focus();

        const zoom = page.locator('[aria-label="Diagram zoom"]').first();
        const readsAs = () =>
          zoom.locator('[aria-live="polite"]').first().textContent();
        expect(await readsAs()).toBe("100%");

        await page.keyboard.press("+");
        expect(await readsAs()).toBe("110%");
        await page.keyboard.press("-");
        await page.keyboard.press("-");
        expect(await readsAs()).toBe("90%");

        // Wide enough to have somewhere to go before asking it to go there.
        for (let step = 0; step < 8; step += 1) await page.keyboard.press("+");
        const scrolledTo = () => frame.evaluate((node) => node.scrollLeft);
        const before = await scrolledTo();
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("ArrowRight");

        expect(await scrolledTo()).toBeGreaterThan(before);
      } finally {
        await target.close();
      }
    }, 300_000);

    /**
     * The ring belongs to whoever is navigating by keyboard.
     *
     * Grabbing a drawing to drag it also focuses the frame, and the browser
     * counts that as focus-visible, so a ring meant for keyboard users appears
     * around something somebody just grabbed with a mouse. The frame marks
     * pointer-driven focus for exactly that reason, and drops the mark the
     * moment a key is pressed.
     */
    it("pans a diagram by dragging, without taking the keyboard's focus ring", async () => {
      const target = await launcher.launch(desktop);
      try {
        const page = (target.automation() as BrowserContext).pages()[0];
        if (!page) throw new Error("No browser page");
        await page.setViewportSize(desktop);
        await target.goto(served.url);
        await diagramsSettled(page);

        const frame = page
          .locator('[role="region"][aria-label$="diagram"]')
          .first();
        await frame.focus();
        // Zoomed past the frame, so there is something to drag it across.
        for (let step = 0; step < 10; step += 1) await page.keyboard.press("+");

        const box = await frame.boundingBox();
        if (!box) throw new Error("The diagram frame has no box");
        const middle = {
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
        };
        const scrolledTo = () => frame.evaluate((node) => node.scrollLeft);
        const before = await scrolledTo();

        await page.mouse.move(middle.x, middle.y);
        await page.mouse.down();
        await page.mouse.move(middle.x - 120, middle.y, { steps: 8 });
        await page.mouse.up();

        expect(await scrolledTo()).toBeGreaterThan(before);
        // Dragged with a pointer, so the keyboard's ring stays off.
        expect(
          await frame.evaluate((node) =>
            node.hasAttribute("data-pointer-focus"),
          ),
        ).toBe(true);

        await page.keyboard.press("ArrowLeft");
        expect(
          await frame.evaluate((node) =>
            node.hasAttribute("data-pointer-focus"),
          ),
        ).toBe(false);
      } finally {
        await target.close();
      }
    }, 300_000);

    /**
     * A long approval keeps its decision in view.
     *
     * The lab carries an approval whose script is hundreds of characters, and
     * the design's claim about it is explicit: the script scrolls inside the
     * card so the decision stays reachable. A card that grew instead would
     * push Allow and Deny off the bottom at the smallest window, which is
     * where it matters.
     */
    it("keeps a long approval's decision reachable at the minimum window", async () => {
      const target = await launcher.launch(minimum);
      try {
        const page = (target.automation() as BrowserContext).pages()[0];
        if (!page) throw new Error("No browser page");
        await page.setViewportSize(minimum);
        await target.goto(served.url);
        await diagramsSettled(page);

        // A named `section` carries the region role implicitly, and an
        // attribute selector only matches an attribute that is actually
        // written, so this asks for the element rather than for the role.
        const approvals = await page
          .locator('section[aria-label="Permission request"]')
          .all();
        expect(approvals.length).toBeGreaterThan(0);

        const tooTall: string[] = [];
        for (const approval of approvals) {
          const measured = await approval.evaluate((node, limit) => {
            const box = node.getBoundingClientRect();
            const scrolls = [...node.querySelectorAll("*")].some((child) => {
              const overflowY = getComputedStyle(child).overflowY;
              return (
                (overflowY === "auto" || overflowY === "scroll") &&
                child.scrollHeight > child.clientHeight + 4
              );
            });
            return {
              height: Math.round(box.height),
              fits: box.height <= limit,
              scrolls,
              label:
                node
                  .querySelector("h3, h4, strong")
                  ?.textContent?.slice(0, 40) ?? "unnamed",
            };
          }, minimum.height);
          // Either it fits the window, or the part that made it long scrolls
          // inside it. What is not allowed is growing past the window with
          // nothing to scroll, because then the decision is unreachable.
          if (!measured.fits && !measured.scrolls)
            tooTall.push(`${measured.label} at ${measured.height}px`);
        }

        expect(tooTall).toEqual([]);
      } finally {
        await target.close();
      }
    }, 300_000);

    /**
     * The browser panel in each of the states it can actually be in.
     *
     * An open panel shows a picture of the page, in the proportions the frame
     * arrived in — a decoded image, not an element that merely exists. The two
     * states with nothing to show must say why instead of leaving an empty
     * frame, which is the whole point of having them.
     */
    it("shows a page, or says why it cannot, in every browser panel state", async () => {
      const target = await launcher.launch(desktop);
      try {
        const page = (target.automation() as BrowserContext).pages()[0];
        if (!page) throw new Error("No browser page");

        for (const size of [desktop, minimum]) {
          await page.setViewportSize(size);
          await target.goto(served.url);

          // By what the panel is called, not by its class: these stylesheets
          // are CSS Modules, so every class name is hashed in a real build.
          const view = page.locator('aside[aria-label$="browser"] img').first();
          await view.waitFor({ state: "visible", timeout: 30_000 });
          const shown = await view.evaluate(async (node) => {
            const image = node as HTMLImageElement;
            await image.decode();
            const box = image.getBoundingClientRect();
            return {
              decoded: image.naturalWidth > 0 && image.naturalHeight > 0,
              ratio: Math.round((box.width / box.height) * 100) / 100,
              natural:
                Math.round((image.naturalWidth / image.naturalHeight) * 100) /
                100,
            };
          });

          expect(shown.decoded).toBe(true);
          // Drawn in the proportions it arrived in, not stretched to its frame.
          expect(shown.ratio).toBeCloseTo(shown.natural, 1);

          // Opening and failed both say something; neither is a blank frame.
          const unavailable = page.locator("#agent-browser-unavailable");
          // Waited for rather than asserted with a web-first matcher: this
          // runs on vitest's `expect`, which has no opinion about locators.
          await unavailable
            .getByText(/Zhiyin could not open a browser window/)
            .first()
            .waitFor({ state: "visible", timeout: 30_000 });
          expect(
            await unavailable.evaluate(
              (node) => node.querySelectorAll("img").length,
            ),
          ).toBe(0);
        }
      } finally {
        await target.close();
      }
    }, 300_000);

    /**
     * Where a person had got to in a conversation survives the window changing
     * size.
     *
     * Resizing reflows the whole thread. Keeping only the scroll offset would
     * replace whatever was on screen with whatever lands at that offset, which
     * for a long conversation is somewhere else entirely. The
     * composed workspace is the only place this exists, because it needs a
     * conversation rather than a component.
     */
    it("keeps a person's place in the conversation when the window is resized", async () => {
      const target = await launcher.launch(desktop);
      try {
        const page = (target.automation() as BrowserContext).pages()[0];
        if (!page) throw new Error("No browser page");
        // A long conversation, still streaming at its end, at the smallest
        // supported window.
        await page.setViewportSize(minimum);
        await target.goto(`${served.url}zhiyin-demo.html?scenario=long`);

        const thread = page.locator(
          '[role="log"][aria-label="Task conversation"]',
        );
        await thread.waitFor({ state: "visible", timeout: 60_000 });

        const scrollable = await thread.evaluate(
          (node) => node.scrollHeight > node.clientHeight + 40,
        );
        expect(scrollable).toBe(true);

        // Scrolled up by the person's own wheel, so the thread stops following
        // its end: a thread pinned to its end would pass by accident.
        const box = await thread.boundingBox();
        if (!box) throw new Error("No conversation box");
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, -1500);
        await page.waitForTimeout(600);

        // The message at the top of the view, and how far below the top of
        // the view it starts.
        const placeOf = () =>
          thread.evaluate((node) => {
            const top = node.getBoundingClientRect().top;
            const marked = node.querySelector("[data-reading-anchor]");
            const message =
              marked ??
              [...node.children].find(
                (child) => child.getBoundingClientRect().bottom > top + 1,
              );
            if (!message) return undefined;
            message.setAttribute("data-reading-anchor", "");
            return {
              offset: message.getBoundingClientRect().top - top,
              atEnd:
                node.scrollHeight - node.scrollTop - node.clientHeight < 80,
            };
          });
        const before = await placeOf();
        expect(before).toMatchObject({ atEnd: false });

        // Wider, as when the browser beside the conversation closes: every
        // message rewraps and the thread still overflows at this height.
        await page.setViewportSize({
          width: desktop.width,
          height: minimum.height,
        });
        // Let the reflow and whatever restores the position both finish.
        await page.waitForTimeout(600);
        expect(
          await thread.evaluate(
            (node) => node.scrollHeight > node.clientHeight + 40,
          ),
        ).toBe(true);

        const widened = await placeOf();
        expect(
          Math.abs((widened?.offset ?? Infinity) - (before?.offset ?? 0)),
        ).toBeLessThanOrEqual(2);

        // And back, as when the browser opens beside the conversation.
        await page.setViewportSize(minimum);
        await page.waitForTimeout(600);
        const narrowed = await placeOf();
        expect(
          Math.abs((narrowed?.offset ?? Infinity) - (before?.offset ?? 0)),
        ).toBeLessThanOrEqual(2);
      } finally {
        await target.close();
      }
    }, 300_000);

    /**
     * The reasoning control, opened and driven at the smallest window.
     *
     * Its panel is portalled to the body and positioned by hand against the
     * button it belongs to, so nothing about it is guaranteed by the layout
     * around it — at 720 by 480 it is perfectly possible to place it off the
     * side, or off the bottom, and no DOM test would notice. The effort slider
     * is a native range, which means the keyboard already works if it is
     * reachable at all; what has to hold is that opening it puts the keyboard
     * there, that the stops read back as words, and that Escape gives focus
     * back to the button that opened it.
     */
    it("opens and drives the reasoning control at the minimum window", async () => {
      const target = await launcher.launch(minimum);
      try {
        const page = (target.automation() as BrowserContext).pages()[0];
        if (!page) throw new Error("No browser page");
        await page.setViewportSize(minimum);
        await target.goto(served.url);

        const bulb = page
          .locator('button[aria-label="Reasoning settings"]')
          .first();
        await bulb.waitFor({ state: "visible", timeout: 30_000 });
        await bulb.scrollIntoViewIfNeeded();
        await bulb.click();

        const panel = page.locator('[role="dialog"][aria-label="Reasoning"]');
        await panel.waitFor({ state: "visible", timeout: 10_000 });

        const withinWindow = async () =>
          panel.evaluate((node) => {
            const box = node.getBoundingClientRect();
            return {
              left: Math.round(box.left),
              right: Math.round(box.right),
              top: Math.round(box.top),
              bottom: Math.round(box.bottom),
              width: window.innerWidth,
              height: window.innerHeight,
            };
          });

        const placed = await withinWindow();
        expect({
          insideLeft: placed.left >= 0,
          insideRight: placed.right <= placed.width,
          insideTop: placed.top >= 0,
          insideBottom: placed.bottom <= placed.height,
        }).toEqual({
          insideLeft: true,
          insideRight: true,
          insideTop: true,
          insideBottom: true,
        });

        // Opening it puts the keyboard on the slider, so there is nothing to
        // tab to before the control can be used.
        const slider = page.locator('input[aria-label="Reasoning effort"]');
        expect(
          await slider.evaluate((node) => node === document.activeElement),
        ).toBe(true);
        expect(await slider.getAttribute("aria-valuetext")).toBe("Medium");

        await page.keyboard.press("ArrowRight");
        expect(await slider.getAttribute("aria-valuetext")).toBe("High");
        await page.keyboard.press("ArrowLeft");
        await page.keyboard.press("ArrowLeft");
        expect(await slider.getAttribute("aria-valuetext")).toBe("Low");

        // Still anchored to its button after the window changes under it.
        await page.setViewportSize({ width: 900, height: 600 });
        await page.waitForTimeout(300);
        const moved = await withinWindow();
        expect({
          insideLeft: moved.left >= 0,
          insideRight: moved.right <= moved.width,
        }).toEqual({ insideLeft: true, insideRight: true });

        await page.keyboard.press("Escape");
        await panel.waitFor({ state: "detached", timeout: 10_000 });
        expect(
          await bulb.evaluate((node) => node === document.activeElement),
        ).toBe(true);
      } finally {
        await target.close();
      }
    }, 300_000);

    /**
     * Settings at the smallest window, by keyboard, and under reduced motion.
     *
     * DOM tests have no layout and no focus order. This drives the state that
     * matters — a key stored, so the model list and the upstream table are
     * actually drawn — and the stored model is one the catalogue no longer
     * lists, so the notice saying so is on screen at 720 by 480.
     */
    it("qualifies the settings page at the minimum window, by keyboard and with motion reduced", async () => {
      const target = await launcher.launch(minimum);
      try {
        const page = (target.automation() as BrowserContext).pages()[0];
        if (!page) throw new Error("No browser page");

        for (const motion of ["no-preference", "reduce"] as const) {
          await page.emulateMedia({ reducedMotion: motion });
          await page.setViewportSize(minimum);
          await target.goto(served.url);

          const settings = page.locator("#model-settings-configured");
          await settings.scrollIntoViewIfNeeded();

          // The withdrawal notice, seen at this size rather than asserted in a
          // DOM test that has no size at all.
          const notice = settings.getByText(/No longer offered/).first();
          await notice.waitFor({ state: "visible", timeout: 30_000 });
          expect(
            await notice.evaluate((node) => {
              const box = node.getBoundingClientRect();
              return box.width > 0 && box.right <= window.innerWidth + 1;
            }),
          ).toBe(true);

          // The stored choice is still the one on record beside it.
          expect(
            await settings.getByText("z-ai/glm-4.9-retired").count(),
          ).toBeGreaterThan(0);

          // Nothing in the page escapes the side of the window.
          expect(await escapingHorizontally(page)).toEqual([]);

          // Reachable by keyboard from the search box: tabbing forward arrives
          // at a model to choose, rather than skipping the list entirely.
          const search = settings.getByLabel("Search models");
          await search.focus();
          const reached: string[] = [];
          for (let step = 0; step < 12; step += 1) {
            await page.keyboard.press("Tab");
            reached.push(
              await page.evaluate(() => {
                const active = document.activeElement;
                if (!active) return "nothing";
                return `${active.getAttribute("role") ?? active.tagName.toLowerCase()}:${(
                  active.getAttribute("aria-label") ??
                  active.textContent ??
                  ""
                )
                  .trim()
                  .slice(0, 40)}`;
              }),
            );
            if (reached.at(-1)?.startsWith("radio")) break;
          }

          expect({
            motion,
            reachedAModel: reached.some((item) => item.startsWith("radio")),
          }).toEqual({ motion, reachedAModel: true });
        }
      } finally {
        await target.close();
      }
    }, 300_000);

    /**
     * The question about conversations an earlier version saved, at the size
     * a person can least afford it to be cut off: each answer inside the
     * window, every one reachable by keyboard, and the outcome it says once an
     * update leaves one conversation as it was.
     */
    it("keeps the saved-conversations question answerable at the minimum window, by keyboard and with motion reduced", async () => {
      const target = await launcher.launch(minimum);
      try {
        const page = (target.automation() as BrowserContext).pages()[0];
        if (!page) throw new Error("No browser page");

        for (const motion of ["no-preference", "reduce"] as const) {
          await page.emulateMedia({ reducedMotion: motion });
          await page.setViewportSize(minimum);
          await target.goto(served.url);

          const ask = page.getByRole("button", {
            name: "Ask, where one cannot be updated",
          });
          await ask.scrollIntoViewIfNeeded();
          await ask.click();
          const dialog = page.getByRole("dialog", {
            name: "Update saved conversations",
          });
          await dialog.waitFor({ state: "visible", timeout: 30_000 });

          const answers = ["Later", "Delete them…", "Update them"];
          const outside: string[] = [];
          for (const name of answers) {
            const box = await dialog
              .getByRole("button", { name, exact: true })
              .boundingBox();
            if (
              !box ||
              box.x < 0 ||
              box.y < 0 ||
              box.x + box.width > minimum.width + 1 ||
              box.y + box.height > minimum.height + 1
            )
              outside.push(name);
          }
          expect({ motion, outside }).toEqual({ motion, outside: [] });
          expect(await escapingHorizontally(page)).toEqual([]);

          // Focus stays inside the dialog and reaches every answer.
          const reached = new Set<string>();
          for (let step = 0; step < 8; step += 1) {
            await page.keyboard.press("Tab");
            reached.add(
              await page.evaluate(
                () =>
                  `${document.activeElement?.closest('[role="dialog"]') ? "inside" : "outside"}:${document.activeElement?.textContent?.trim() ?? ""}`,
              ),
            );
          }
          expect(
            [...reached].filter((item) => item.startsWith("outside")),
          ).toEqual([]);
          for (const name of answers)
            expect(reached).toContain(`inside:${name}`);

          await dialog
            .getByRole("button", { name: "Update them", exact: true })
            .focus();
          await page.keyboard.press("Enter");
          await page
            .getByText(
              "2 conversations were updated. One could not be, and was left as it was.",
            )
            .waitFor({ state: "visible", timeout: 30_000 });
          await page.getByRole("button", { name: "Done" }).click();
          await dialog.waitFor({ state: "hidden" });
        }
      } finally {
        await target.close();
      }
    }, 300_000);

    /**
     * The reasoning control in the states a model can put it in.
     *
     * A model that requires reasoning must not offer to turn it off; one that
     * merely allows it must show that nobody has; and a model that cannot report
     * its settings must say so rather than offer a choice it cannot honour.
     *
     * The panel is also followed while the page scrolls under it, which is the
     * half of its anchoring that resizing does not cover.
     */
    it("shows the reasoning control as required, as off, and as unavailable", async () => {
      const target = await launcher.launch(minimum);
      try {
        const page = (target.automation() as BrowserContext).pages()[0];
        if (!page) throw new Error("No browser page");
        await page.setViewportSize(minimum);
        await target.goto(served.url);

        const section = page.locator("#reasoning-controls");
        await section.scrollIntoViewIfNeeded();
        const bulbs = section.locator(
          'button[aria-label="Reasoning settings"]',
        );
        await bulbs.first().waitFor({ state: "visible", timeout: 30_000 });

        // What each one reports on hover, without being opened at all.
        expect(await bulbs.count()).toBe(2);
        const label = page.getByRole("tooltip");
        await bulbs.nth(0).hover();
        await expect.poll(() => label.textContent()).toBe("Reasoning: Max");
        await bulbs.nth(1).hover();
        await expect.poll(() => label.textContent()).toBe("Reasoning: Off");

        const unavailable = section.locator(
          'button[aria-label="Reasoning settings unavailable"]',
        );
        expect(await unavailable.count()).toBe(1);
        expect(await unavailable.isDisabled()).toBe(true);

        // Required: the panel says so, and there is no way down to "Off".
        await bulbs.nth(0).click();
        const panel = page.locator('[role="dialog"][aria-label="Reasoning"]');
        await panel.waitFor({ state: "visible", timeout: 10_000 });
        expect(await panel.getByText("Required by this model").count()).toBe(1);

        const slider = page.locator('input[aria-label="Reasoning effort"]');
        expect(await slider.getAttribute("aria-valuetext")).toBe("Max");
        for (let step = 0; step < 6; step += 1)
          await page.keyboard.press("ArrowLeft");
        expect(await slider.getAttribute("aria-valuetext")).toBe("Low");

        /*
         * Followed while the page moves under it. The panel is placed against
         * its button by hand, so scrolling is the case where it can be left
         * behind — and it is a different code path from resizing.
         */
        const gap = async () =>
          page.evaluate(() => {
            const dialog = document.querySelector(
              '[role="dialog"][aria-label="Reasoning"]',
            );
            const trigger = document.querySelector(
              '#reasoning-controls button[aria-label="Reasoning settings"]',
            );
            if (!dialog || !trigger) return undefined;
            return Math.round(
              trigger.getBoundingClientRect().top -
                dialog.getBoundingClientRect().bottom,
            );
          });

        const before = await gap();
        await page.mouse.wheel(0, 180);
        await page.waitForTimeout(300);
        const after = await gap();

        expect({
          before,
          after,
          followed:
            before !== undefined &&
            after !== undefined &&
            Math.abs(after - before) <= 2,
        }).toMatchObject({ followed: true });
      } finally {
        await target.close();
      }
    }, 300_000);

    /**
     * Installing a plugin, and managing one already installed, at the
     * smallest supported window, with every control able to take focus.
     *
     * The plugin directory is a two-pane surface — a narrow list beside a
     * detail pane — which is exactly the shape that goes off the side of a
     * small window without ever failing a DOM test, since jsdom has no
     * layout to escape. "Import from a folder…" sits at the end of a long
     * sidebar list, and a personal package's management row only exists
     * once that package is selected, so each is focused here and checked
     * against the window rather than asserted by role alone.
     */
    it("reaches plugin install and personal-package management by keyboard at the minimum window", async () => {
      const target = await launcher.launch(minimum);
      try {
        const page = (target.automation() as BrowserContext).pages()[0];
        if (!page) throw new Error("No browser page");
        await page.setViewportSize(minimum);
        await target.goto(served.url);

        const section = page.locator("#library");
        await section.scrollIntoViewIfNeeded();

        const install = section.getByRole("button", {
          name: "Import from a folder…",
        });
        await install.waitFor({ state: "visible", timeout: 30_000 });
        await install.focus();
        expect(
          await install.evaluate((node) => node === document.activeElement),
        ).toBe(true);
        expect(await escapingHorizontally(page)).toEqual([]);

        const personal = section.getByRole("button", {
          name: /Team Standards/,
        });
        await personal.click();
        const details = section.getByRole("region", {
          name: "Team Standards details",
        });
        await details.waitFor({ state: "visible", timeout: 10_000 });

        const update = details.getByRole("button", {
          name: "Update from a folder…",
        });
        const rollback = details.getByRole("button", { name: "Roll back" });
        const remove = details.getByRole("button", { name: "Remove" });
        for (const button of [update, rollback, remove]) {
          await button.focus();
          expect(
            await button.evaluate((node) => node === document.activeElement),
          ).toBe(true);
          expect(
            await button.evaluate((node) => {
              const box = node.getBoundingClientRect();
              return (
                box.width > 0 &&
                box.right <= window.innerWidth + 1 &&
                box.bottom <= window.innerHeight + 1
              );
            }),
          ).toBe(true);
        }
        expect(await escapingHorizontally(page)).toEqual([]);

        await remove.click();
        const confirm = section.getByText("Remove Team Standards?");
        await confirm.waitFor({ state: "visible", timeout: 10_000 });
        const confirmButton = section.getByRole("button", {
          name: "Remove permanently",
        });
        await confirmButton.focus();
        expect(
          await confirmButton.evaluate(
            (node) => node === document.activeElement,
          ),
        ).toBe(true);
      } finally {
        await target.close();
      }
    }, 300_000);
  },
);
