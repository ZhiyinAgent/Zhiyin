import { describe, expect, it } from "vitest";
import { inspectBrowser } from "../src/browser-presentation.js";
import { fakeBrowser } from "./fakes.js";

/**
 * A permission request for a browser action is read the same way as one for a
 * shell command: what it is, what it can do, and the exact thing that will
 * happen. These tests are about that reading, not about Playwright.
 */
const onPage = (url: string, title = "Pricing — Example") =>
  fakeBrowser({
    state: () => ({ status: "open", url, title, loading: false }),
  });

describe("browser permission requests", () => {
  it("names the page an action lands on, not the browser it uses", async () => {
    const inspection = await inspectBrowser(
      onPage("https://example.com/pricing"),
      "browser_click",
      { element: "the Buy button", target: "e42" },
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
      { element: "the Buy button", target: "e42" },
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
        target: "e42",
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

  it("refuses an action on an element that does not say in words what it acts on, before anyone is asked", async () => {
    const page = onPage("https://bank.example/settings");
    const calls: [string, Record<string, unknown>][] = [
      ["browser_click", { target: "e42" }],
      ["browser_type", { target: "#card", text: "4111" }],
      ["browser_hover", { target: "e7" }],
      ["browser_select_option", { target: "e9", values: ["Close account"] }],
      [
        "browser_drag",
        { startTarget: "e1", endTarget: "e2", startElement: "a card" },
      ],
    ];

    for (const [name, args] of calls)
      expect(await inspectBrowser(page, name, args)).toMatchObject({
        ok: false,
        correctable: true,
      });
  });

  it("shows how a click is made: which button, a double click, and keys held", async () => {
    const inspection = await inspectBrowser(
      onPage("https://bank.example/settings"),
      "browser_click",
      {
        element: "Delete account",
        target: "e3",
        button: "right",
        doubleClick: true,
        modifiers: ["ControlOrMeta"],
      },
    );

    expect(inspection.ok && inspection.invocation?.arguments).toEqual([
      { name: "Page", value: "https://bank.example/settings", readable: true },
      { name: "Element", value: "Delete account", readable: true },
      { name: "Double click", value: "Yes", readable: true },
      { name: "Mouse button", value: "right", readable: true },
      { name: "Keys held", value: "ControlOrMeta", readable: true },
    ]);
  });

  it("shows a selector an action aims at, whole, and never a snapshot reference", async () => {
    const page = onPage("https://bank.example/settings");

    const bySelector = await inspectBrowser(page, "browser_click", {
      element: "the delete button",
      target: "text=Delete my account",
    });
    const byReference = await inspectBrowser(page, "browser_click", {
      element: "the delete button",
      target: "f1e42",
    });
    const dragged = await inspectBrowser(page, "browser_drag", {
      startElement: "a card",
      startTarget: "#card-1",
      endElement: "the bin",
      endTarget: "e9",
    });

    expect(bySelector.ok && bySelector.invocation?.arguments).toContainEqual({
      name: "Selector",
      value: "text=Delete my account",
      readable: true,
    });
    expect(JSON.stringify(byReference)).not.toContain('f1e42"}');
    expect(
      byReference.ok &&
        byReference.invocation?.arguments.map((argument) => argument.name),
    ).toEqual(["Page", "Element"]);
    expect(dragged.ok && dragged.invocation?.arguments).toEqual([
      { name: "Page", value: "https://bank.example/settings", readable: true },
      { name: "Dragged from", value: "a card", readable: true },
      { name: "Dragged from, by selector", value: "#card-1", readable: true },
      { name: "Dropped on", value: "the bin", readable: true },
    ]);
  });

  it("says when typing goes in one key at a time", async () => {
    const inspection = await inspectBrowser(
      onPage("https://example.com/form"),
      "browser_type",
      { element: "the code field", target: "e4", text: "1234", slowly: true },
    );

    expect(inspection.ok && inspection.invocation?.arguments).toContainEqual({
      name: "One key at a time",
      value: "Yes",
      readable: true,
    });
  });

  it("refuses code run on an element that does not say in words which element, and names it when it does", async () => {
    const page = onPage("https://bank.example/settings");

    const unnamed = await inspectBrowser(page, "browser_evaluate", {
      target: "e7",
      function: "(el) => el.click()",
    });
    const named = await inspectBrowser(page, "browser_evaluate", {
      element: "the Close account button",
      target: "e7",
      function: "(el) => el.click()",
    });
    const onPageAlone = await inspectBrowser(page, "browser_evaluate", {
      function: "() => document.title",
    });

    expect(unnamed).toMatchObject({ ok: false, correctable: true });
    expect(named.ok && named.invocation?.arguments).toEqual([
      { name: "Page", value: "https://bank.example/settings", readable: true },
      { name: "Element", value: "the Close account button", readable: true },
      { name: "Code", value: "(el) => el.click()", runs: true },
    ]);
    expect(onPageAlone).toMatchObject({ ok: true });
  });

  it("shows each field a form fill writes, by its name and what goes in it, and refuses a field named by nothing", async () => {
    const page = onPage("https://shop.example/checkout");

    const filled = await inspectBrowser(page, "browser_fill_form", {
      fields: [
        { name: "Email", type: "textbox", target: "e3", value: "a@b.test" },
        {
          name: "",
          element: "the newsletter box",
          type: "checkbox",
          target: "#news",
          value: "true",
        },
      ],
    });
    const unnamed = await inspectBrowser(page, "browser_fill_form", {
      fields: [{ name: " ", type: "textbox", target: "e3", value: "secret" }],
    });

    expect(filled.ok && filled.invocation?.arguments).toEqual([
      { name: "Page", value: "https://shop.example/checkout", readable: true },
      { name: "Field: Email", value: "a@b.test", readable: true },
      { name: "Field: the newsletter box", value: "true", readable: true },
      {
        name: "Field: the newsletter box, by selector",
        value: "#news",
        readable: true,
      },
    ]);
    expect(unnamed).toMatchObject({ ok: false, correctable: true });
  });

  it("shows text a wait is for to disappear, and no file name the browser never receives", async () => {
    const page = onPage("https://example.com/report");

    const waiting = await inspectBrowser(page, "browser_wait_for", {
      textGone: "Loading…",
    });
    const picture = await inspectBrowser(page, "browser_take_screenshot", {
      scale: "css",
      filename: "../../elsewhere.png",
    });

    expect(waiting.ok && waiting.invocation?.arguments).toContainEqual({
      name: "Wait until gone",
      value: "Loading…",
      readable: true,
    });
    expect(JSON.stringify(picture.ok && picture.invocation)).not.toContain(
      "elsewhere",
    );
  });

  it("shows every input a call sends, also those it has no words of its own for", async () => {
    const page = onPage("https://example.com/report");

    const requests = await inspectBrowser(page, "browser_network_requests", {
      static: true,
      filter: "/api/token",
    });
    const messages = await inspectBrowser(page, "browser_console_messages", {
      level: "debug",
    });

    expect(requests.ok && requests.invocation?.arguments).toEqual([
      { name: "Page", value: "https://example.com/report", readable: true },
      { name: "Static", value: "Yes", readable: true },
      { name: "Filter", value: "/api/token", readable: true },
    ]);
    expect(messages.ok && messages.invocation?.arguments).toContainEqual({
      name: "Level",
      value: "debug",
      readable: true,
    });
  });

  it("keeps a long input readable rather than pasting the whole of it", async () => {
    const text = "a".repeat(900);
    const inspection = await inspectBrowser(
      onPage("https://example.com/pricing"),
      "browser_type",
      { element: "the notes field", target: "e1", text },
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
      { name: "Address", value: "https://example.org/docs", readable: true },
    ]);
  });

  it("refuses to open a file address however it is written", async () => {
    for (const url of [
      "file:///C:/Users/notes.html",
      "FILE:///C:/Users/notes.html",
      " File:///C:/Users/notes.html",
    ])
      expect(
        await inspectBrowser(
          onPage("https://example.com/pricing"),
          "browser_navigate",
          { url },
        ),
      ).toMatchObject({
        ok: false,
        reason: expect.stringContaining("File URLs are not supported"),
      });
  });

  it("opens only web addresses", async () => {
    for (const url of [
      "view-source:https://example.com/",
      "edge://settings",
      "data:text/html,hello",
      "about:config",
    ])
      expect(
        await inspectBrowser(
          onPage("https://example.com/pricing"),
          "browser_navigate",
          { url },
        ),
      ).toMatchObject({ ok: false, reason: expect.stringContaining("web") });
  });
});

describe("reading the workspace preview", () => {
  const previewOrigin = "http://127.0.0.1:51234";
  /** A browser showing this page, with the workspace preview serving its own origin. */
  const showing = (url: string) =>
    fakeBrowser({
      state: () => ({
        status: "open",
        url,
        title: "Lin’s 30th",
        loading: false,
      }),
      preview: {
        serves: (address: string) => address.startsWith(previewOrigin),
      },
    });
  const reads: readonly [string, Record<string, unknown>][] = [
    ["browser_take_screenshot", {}],
    ["browser_snapshot", {}],
    ["browser_console_messages", {}],
    ["browser_network_requests", {}],
    ["browser_resize", { width: 390, height: 844 }],
  ];

  it("declares each read of the preview a read of the workspace that changes nothing and brings no outside content, bound to the preview", async () => {
    for (const [name, args] of reads) {
      const inspection = await inspectBrowser(
        showing(`${previewOrigin}/token/lin.html#sat`),
        name,
        args,
      );
      expect(inspection, name).toMatchObject({
        ok: true,
        effects: expect.objectContaining({
          reads: "workspace",
          changes: "none",
          brings: "none",
        }),
        identity: JSON.stringify({ preview: previewOrigin }),
      });
    }
  });

  it("binds nothing to the preview for the same reads of a website", async () => {
    for (const [name, args] of reads) {
      const inspection = await inspectBrowser(
        showing("https://example.com/pricing"),
        name,
        args,
      );
      if (!inspection.ok) throw new Error(`${name} should be inspected`);
      expect(inspection.identity, name).not.toBe(
        JSON.stringify({ preview: previewOrigin }),
      );
    }
  });

  it("binds nothing to the preview for opening it, running code, clicking or typing on it, which still ask", async () => {
    const page = `${previewOrigin}/token/lin.html`;
    const calls: readonly [string, Record<string, unknown>][] = [
      ["browser_evaluate", { function: "() => document.title" }],
      ["browser_click", { element: "the Saturday tab", target: "e4" }],
      ["browser_type", { element: "the note field", target: "e5", text: "hi" }],
      ["browser_navigate", { url: "https://example.com/" }],
    ];
    for (const [name, args] of calls) {
      const inspection = await inspectBrowser(showing(page), name, args);
      if (!inspection.ok) throw new Error(`${name} should be inspected`);
      expect(inspection.identity, name).not.toBe(
        JSON.stringify({ preview: previewOrigin }),
      );
    }
  });
});
