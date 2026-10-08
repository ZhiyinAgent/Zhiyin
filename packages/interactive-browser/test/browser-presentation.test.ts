import { describe, expect, it } from "vitest";
import { inspectBrowser } from "../src/browser-presentation.js";
import type { InteractiveBrowser } from "../src/index.js";

/**
 * A permission request for a browser action is read the same way as one for a
 * shell command: what it is, what it can do, and the exact thing that will
 * happen. These tests are about that reading, not about Playwright.
 */
const onPage = (url: string, title = "Pricing — Example") =>
  ({
    state: () => ({ status: "open", url, title, loading: false }),
  }) as unknown as InteractiveBrowser;

describe("browser permission requests", () => {
  it("names the page an action lands on, not the browser it uses", async () => {
    const inspection = await inspectBrowser(
      onPage("https://example.com/pricing"),
      "browser_click",
      { element: "the Buy button", ref: "e42" },
    );

    expect(inspection).toMatchObject({
      ok: true,
      action: "Click on page",
      target: "https://example.com/pricing",
    });
  });

  it("says what an action does to the live site rather than reassuring", async () => {
    const acting = await inspectBrowser(
      onPage("https://example.com/pricing"),
      "browser_click",
      { element: "the Buy button", ref: "e42" },
    );
    const reading = await inspectBrowser(
      onPage("https://example.com/pricing"),
      "browser_snapshot",
      {},
    );

    if (!acting.ok || !reading.ok) throw new Error("Both should be allowed");
    expect(acting.detail).not.toEqual(reading.detail);
    for (const detail of [acting.detail, reading.detail])
      expect(detail).not.toMatch(/sign-ins/);
  });

  it("shows the page and the person-readable inputs, and never the internals", async () => {
    const inspection = await inspectBrowser(
      onPage("https://example.com/pricing"),
      "browser_type",
      {
        element: "the search box",
        ref: "e42",
        text: "standing desk",
        submit: true,
      },
    );

    if (!inspection.ok) throw new Error("Typing should be allowed");
    const shown = inspection.invocation?.arguments ?? [];
    expect(shown.map((argument) => argument.name)).toEqual([
      "Page",
      "Element",
      "Text",
      "Press Enter",
    ]);
    expect(shown.find((argument) => argument.name === "Text")?.value).toBe(
      "standing desk",
    );
    expect(
      shown.find((argument) => argument.name === "Press Enter")?.value,
    ).toBe("Yes");
    expect(JSON.stringify(shown)).not.toContain("e42");
  });

  it("keeps a long input readable rather than pasting the whole of it", async () => {
    const text = "a".repeat(900);
    const inspection = await inspectBrowser(
      onPage("https://example.com/pricing"),
      "browser_type",
      { element: "the notes field", ref: "e1", text },
    );

    if (!inspection.ok) throw new Error("Typing should be allowed");
    expect(inspection.command.length).toBeLessThan(600);
    expect(inspection.command).toContain("browser_type(");
  });

  it("shows the address being opened as the target of a navigation", async () => {
    const inspection = await inspectBrowser(
      onPage("https://example.com/pricing"),
      "browser_navigate",
      { url: "https://example.org/docs" },
    );

    expect(inspection).toMatchObject({
      ok: true,
      target: "https://example.org/docs",
    });
    if (!inspection.ok) return;
    expect(inspection.invocation?.arguments).toEqual([
      { name: "Address", value: "https://example.org/docs" },
    ]);
  });
});
