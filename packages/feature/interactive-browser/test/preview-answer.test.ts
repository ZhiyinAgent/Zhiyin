/**
 * What opening the preview answers: the page as it is now, so the model can
 * judge it without another call — its viewport and whether the page is wider,
 * the console's errors, the page's snapshot, and a picture for a model that
 * can see one — and every file the page asked for and was not served.
 */

import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { browserAutomation } from "../src/automation-server.js";
import type { BrowserSession } from "../src/index.js";
import { fakeAutomationServer } from "./fake-automation-server.js";
import { heldBrowser, sessionWithPreview } from "./held-browser.js";

const folders = new TemporaryFolders();
const sessions: BrowserSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await folders.removeAll();
});

type Measured = {
  readonly width: number;
  readonly height: number;
  /** The width the page has to fill, the viewport less any scroll bar. */
  readonly room: number;
  readonly pageWidth: number;
  readonly widest?: { readonly name: string; readonly right: number };
  readonly scrollers?: readonly {
    readonly name: string;
    readonly width: number;
    readonly contentWidth: number;
  }[];
};

/** Playwright's answers, in the words its tools use. */
function playwright(
  page: {
    readonly measured?: Measured | "fails";
    readonly errors?: readonly string[];
    /** The console's whole answer, in place of the one Playwright gives. */
    readonly console?: string;
    readonly snapshot?: string;
  } = {},
) {
  const measured = page.measured ?? {
    width: 800,
    height: 600,
    room: 800,
    pageWidth: 800,
  };
  const errors = page.errors ?? [];
  const snapshot =
    page.snapshot ??
    '- heading "Notes" [level=1] [ref=e2]\n- paragraph [ref=e3]: notes';
  return (name: string): readonly unknown[] => {
    const text = (said: string) => [{ type: "text", text: said }];
    if (name === "browser_console_messages")
      return text(
        page.console ??
          `### Result\nTotal messages: ${errors.length + 1} (Errors: ${errors.length}, Warnings: 1)\nReturning ${errors.length} messages for level "error"\n\n${errors.join("\n")}`,
      );
    if (name === "browser_evaluate")
      return measured === "fails"
        ? text(
            "### Error\nEvalError: Refused to evaluate a string as JavaScript",
          )
        : text(
            `### Result\n${JSON.stringify(measured, null, 2)}\n### Ran Playwright code\n\`\`\`js\nawait page.evaluate('() => …');\n\`\`\``,
          );
    if (name === "browser_snapshot")
      return text(
        `### Page\n- Page URL: http://127.0.0.1/index.html\n- Page Title: Notes\n- Console: ${errors.length} errors, 1 warnings\n### Snapshot\n\`\`\`yaml\n${snapshot}\n\`\`\``,
      );
    if (name === "browser_take_screenshot")
      return [
        ...text("### Result\n- [Screenshot of viewport](./page.png)"),
        { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
      ];
    return text("done");
  };
}

async function previewing(
  page: Parameters<typeof playwright>[0] = {},
  seeing = false,
) {
  const made = heldBrowser();
  const opened = await sessionWithPreview(made, folders);
  sessions.push(opened.session);
  const server = fakeAutomationServer(
    [
      { name: "browser_snapshot", description: "Read the page." },
      { name: "browser_console_messages", description: "Console." },
      { name: "browser_evaluate", description: "Run code on the page." },
    ],
    playwright(page),
  );
  const automation = browserAutomation(opened.session, {
    createConnection: server.createConnection,
    acceptsImages: () => seeing,
  });
  return { ...opened, server, automation };
}

type Content = { type: string; text?: string; data?: string };
const content = (result: unknown) => (result as { content: Content[] }).content;
const text = (result: unknown) =>
  content(result)
    .map((part) => part.text ?? "")
    .join("\n");

describe("opening the preview", () => {
  it("answers with the viewport, the page's width, the console's errors and the page's snapshot", async () => {
    const { automation } = await previewing({
      errors: [
        "[ERROR] Uncaught TypeError: chart.draw is not a function @ http://127.0.0.1/app.js:3",
      ],
    });

    const answer = await automation.callTool("browser_preview", {
      path: "index.html",
    });

    expect((answer as { isError?: boolean }).isError).toBeFalsy();
    const said = text(answer);
    expect(said).toContain("Opened index.html in the browser.");
    expect(said).toContain("Viewport 800 × 600 px. The page fits its width.");
    expect(said).toContain("1 console error since the page opened:");
    expect(said).toContain("chart.draw is not a function");
    expect(said).toContain('- heading "Notes" [level=1] [ref=e2]');
    // Only what the measurement found, not the code that measured it.
    expect(said).not.toContain("Ran Playwright code");
  });

  it("says when the console has no errors", async () => {
    const { automation } = await previewing();

    const said = text(
      await automation.callTool("browser_preview", { path: "index.html" }),
    );

    expect(said).toContain("No console errors since the page opened.");
  });

  it("says the number of console errors is unknown when it cannot read how the console counts them", async () => {
    const { automation } = await previewing({
      console:
        "### Result\nSome other wording of a count\n\n[ERROR] Uncaught ReferenceError: chart is not defined",
    });

    const said = text(
      await automation.callTool("browser_preview", { path: "index.html" }),
    );

    expect(said).not.toContain("No console errors");
    expect(said).toContain(
      "How many console errors there were since the page opened is not known: browser_console_messages lists them.",
    );
    expect(said).toContain("chart is not defined");
  });

  it("says the number of console errors is unknown when the console's answer holds no count", async () => {
    const { automation } = await previewing({ console: "### Result\n" });

    const said = text(
      await automation.callTool("browser_preview", { path: "index.html" }),
    );

    expect(said).not.toContain("No console errors");
    expect(said).toContain(
      "How many console errors there were since the page opened is not known: browser_console_messages lists them.",
    );
  });

  it("names the element that makes the page wider than the viewport, and by how much", async () => {
    const { automation } = await previewing({
      measured: {
        width: 390,
        height: 844,
        room: 390,
        pageWidth: 1180,
        widest: { name: "table.prices", right: 1180 },
      },
    });

    const said = text(
      await automation.callTool("browser_preview", { path: "index.html" }),
    );

    expect(said).toContain(
      "Viewport 390 × 844 px. The page is 1180 px wide, 790 px wider than the viewport: table.prices reaches 1180 px.",
    );
  });

  it("says how much of the viewport its scroll bar takes, so the widths it gives agree", async () => {
    const { automation } = await previewing({
      measured: {
        width: 800,
        height: 600,
        room: 785,
        pageWidth: 800,
        widest: { name: "div.hero", right: 800 },
      },
    });

    const said = text(
      await automation.callTool("browser_preview", { path: "index.html" }),
    );

    expect(said).toContain(
      "Viewport 800 × 600 px, of which the vertical scroll bar takes 15 px. The page is 800 px wide, 15 px wider than the 785 px left: div.hero reaches 800 px.",
    );
  });

  it("names a large box that scrolls sideways, and how wide its content is", async () => {
    const { automation } = await previewing({
      measured: {
        width: 800,
        height: 600,
        room: 800,
        pageWidth: 800,
        scrollers: [{ name: "main", width: 800, contentWidth: 1400 }],
      },
    });

    const said = text(
      await automation.callTool("browser_preview", { path: "index.html" }),
    );

    expect(said).toContain(
      "Viewport 800 × 600 px. The page fits its width. main scrolls sideways: its content is 1400 px wide in a box 800 px wide.",
    );
  });

  it("gives one count of the console's errors", async () => {
    const { automation } = await previewing({
      errors: ["[ERROR] first", "[ASSERT] second"],
    });

    const said = text(
      await automation.callTool("browser_preview", { path: "index.html" }),
    );

    expect(said).toContain("2 console errors since the page opened:");
    // The snapshot's own count, which leaves some of them out, is not given.
    expect(said).not.toContain("- Console:");
    expect(said).toContain("- Page Title: Notes");
  });

  it("says where a long run of console errors stops and how to read the rest", async () => {
    const errors = Array.from(
      { length: 200 },
      (_, index) =>
        `[ERROR] Uncaught TypeError: row ${index} could not be drawn @ http://127.0.0.1/app.js:${index}`,
    );
    const { automation } = await previewing({ errors });

    const said = text(
      await automation.callTool("browser_preview", { path: "index.html" }),
    );

    expect(said).toContain("200 console errors since the page opened:");
    expect(said).toContain("row 0 could not be drawn");
    expect(said).not.toContain("row 199 could not be drawn");
    expect(said).toMatch(
      /The console's errors stop here, at 4,000 of [\d,]+ characters: browser_console_messages gives them all\./,
    );
    const console = said.slice(
      said.indexOf("200 console errors"),
      said.indexOf("The console's errors stop here"),
    );
    expect(console.length).toBeLessThan(4_100);
  });

  it("gives a model that can see a picture of what the window shows", async () => {
    const { automation } = await previewing({}, true);

    const answer = await automation.callTool("browser_preview", {
      path: "index.html",
    });

    expect(content(answer)).toContainEqual({
      type: "image",
      data: "iVBORw0KGgo=",
      mimeType: "image/png",
    });
  });

  it("takes no picture for a model that cannot see one", async () => {
    const { automation, server } = await previewing({}, false);

    const answer = await automation.callTool("browser_preview", {
      path: "index.html",
    });

    expect(content(answer).some((part) => part.type === "image")).toBe(false);
    expect(server.called()).not.toContain("browser_take_screenshot");
  });

  it("says where a long snapshot stops and how to read the rest", async () => {
    const long = Array.from(
      { length: 2_000 },
      (_, index) => `- listitem [ref=e${index}]: Row ${index} of the table`,
    ).join("\n");
    const { automation } = await previewing({ snapshot: long });

    const said = text(
      await automation.callTool("browser_preview", { path: "index.html" }),
    );

    expect(said.length).toBeLessThan(25_000);
    expect(said).toContain("- listitem [ref=e0]: Row 0 of the table");
    expect(said).not.toContain("Row 1999 of the table");
    expect(said).toMatch(
      /The snapshot stops here, at 20,000 of [\d,]+ characters: browser_snapshot gives the whole page\./,
    );
  });

  it("opens the page all the same when part of it cannot be read, and says which part", async () => {
    const { automation } = await previewing({ measured: "fails" });

    const answer = await automation.callTool("browser_preview", {
      path: "index.html",
    });

    expect((answer as { isError?: boolean }).isError).toBeFalsy();
    expect(text(answer)).toContain(
      "The viewport could not be measured: EvalError: Refused to evaluate a string as JavaScript",
    );
    expect(text(answer)).toContain('- heading "Notes"');
  });

  it("is described as the way to see the file again after changing it", async () => {
    const { automation } = await previewing();

    const preview = (await automation.listTools()).find(
      (tool) => tool.name === "browser_preview",
    );

    expect(preview?.description).toContain(
      "Call it again after changing the file to see the change.",
    );
  });
});

describe("files the page asked for and did not get", () => {
  it("are each named, with why, in the next answer from the browser", async () => {
    const { automation, address } = await previewing();

    await fetch(new URL("assets/model.glb", address));
    const first = text(await automation.callTool("browser_snapshot", {}));
    const second = text(await automation.callTool("browser_snapshot", {}));

    expect(first).toContain(
      "assets/model.glb was not served: there is no such file.",
    );
    expect(second).not.toContain("model.glb");
  });

  it("are named in the preview's own answer when the page asked for them as it opened", async () => {
    const { automation, address } = await previewing();
    await automation.callTool("browser_preview", { path: "index.html" });

    await fetch(new URL("notes.docx", address));
    const said = text(
      await automation.callTool("browser_preview", { path: "index.html" }),
    );

    expect(said).toContain("notes.docx was not served: there is no such file.");
  });
});
