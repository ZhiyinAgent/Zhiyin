import { describe, expect, it } from "vitest";
import { inspectBrowser } from "../src/browser-presentation.js";
import { fakeBrowser } from "./fakes.js";

/**
 * What each browser call declares it does, in the shared vocabulary of
 * effects: where it reads, what it sends and to where, and whether what comes
 * back was written by someone else. Two pages answer differently: a website,
 * and the workspace preview, a page served from the conversation's folder on
 * this computer.
 */
const previewOrigin = "http://127.0.0.1:51234";
const previewPage = `${previewOrigin}/token/lin.html`;
const website = "https://shop.example/cart?step=2";

const showing = (url: string, more: Record<string, unknown> = {}) =>
  fakeBrowser({
    state: () => ({ status: "open", url, title: "A page", loading: false }),
    preview: {
      serves: (address: string) => address.startsWith(previewOrigin),
      inspect: async (path: string) => ({ root: "C:/work", path }),
    },
    uploads: {
      inspect: async (paths: readonly string[]) =>
        paths.map((path) => ({ path, bytes: 4, sha256: "ab" })),
    },
    ...more,
  });

const nothing = {
  reads: "none",
  changes: "none",
  sends: "none",
  actsAsPerson: "none",
  runs: "none",
  lasting: false,
  brings: "none",
} as const;

async function effectsOf(
  page: string,
  name: string,
  args: Record<string, unknown>,
) {
  const inspection = await inspectBrowser(showing(page), name, args);
  if (!inspection.ok) throw new Error(`${name}: ${inspection.reason}`);
  return inspection.effects;
}

describe("what opening an address declares", () => {
  it("sends the visit to the exact address it opens, and brings back a page someone else wrote", async () => {
    expect(
      await effectsOf(website, "browser_navigate", {
        url: "  docs.example/guide#intro ",
      }),
    ).toEqual({
      ...nothing,
      sends: "chosen",
      destination: "https://docs.example/guide#intro",
      carries: "address",
      brings: "outside",
    });
  });

  it("reads the workspace and brings nothing from outside when it opens the preview's own page", async () => {
    expect(
      await effectsOf(website, "browser_navigate", {
        url: `${previewOrigin}/token/other.html`,
      }),
    ).toEqual({
      ...nothing,
      reads: "workspace",
      sends: "chosen",
      destination: `${previewOrigin}/token/other.html`,
      carries: "address",
      brings: "none",
    });
  });

  it("sends nothing and brings nothing for a blank page", async () => {
    expect(
      await effectsOf(website, "browser_navigate", { url: "about:blank" }),
    ).toEqual(nothing);
  });

  it("brings back a page someone else wrote when it goes back, wherever it was, since the earlier page is not known", async () => {
    for (const page of [website, previewPage])
      expect(await effectsOf(page, "browser_navigate_back", {}), page).toEqual({
        ...nothing,
        brings: "outside",
      });
  });
});

describe("what acting on the open page declares", () => {
  const actions: readonly [string, Record<string, unknown>][] = [
    ["browser_click", { element: "the Pay button", target: "e4" }],
    ["browser_type", { element: "the card field", target: "e5", text: "4111" }],
    [
      "browser_fill_form",
      {
        fields: [{ name: "Email", type: "textbox", target: "e6", value: "a" }],
      },
    ],
    ["browser_press_key", { key: "Enter" }],
    [
      "browser_select_option",
      { element: "the country list", target: "e7", values: ["France"] },
    ],
    ["browser_hover", { element: "the menu", target: "e8" }],
    [
      "browser_drag",
      {
        startElement: "a card",
        startTarget: "e1",
        endElement: "the bin",
        endTarget: "e2",
      },
    ],
    ["browser_handle_dialog", { accept: true, promptText: "yes" }],
    ["browser_evaluate", { function: "() => document.cookie" }],
    ["browser_file_upload", {}],
  ];

  /** Actions whose arguments hold text the site receives: typed, keyed, answered or run. */
  const writing = new Set([
    "browser_type",
    "browser_fill_form",
    "browser_press_key",
    "browser_handle_dialog",
    "browser_evaluate",
  ]);
  const carried = (name: string) => ({
    ...(writing.has(name) ? {} : { carries: "nothing" as const }),
    // Code the model wrote runs in the page, sealed off in the browser.
    ...(name === "browser_evaluate" ? { runs: "sealed" as const } : {}),
  });

  it("sends what it carries to the site the page is on, and brings back what that site wrote", async () => {
    for (const [name, args] of actions)
      expect(await effectsOf(website, name, args), name).toEqual({
        ...nothing,
        sends: "chosen",
        destination: "https://shop.example",
        ...carried(name),
        brings: "outside",
      });
  });

  it("says a click, a hover, a choice from the page's list or a drag carries nothing the model wrote, and typing, keys, an answer or code carry its words", async () => {
    const said = await Promise.all(
      actions.map(async ([name, args]) => [
        name,
        (await effectsOf(website, name, args))?.carries,
      ]),
    );

    expect(Object.fromEntries(said)).toEqual({
      browser_click: "nothing",
      browser_type: undefined,
      browser_fill_form: undefined,
      browser_press_key: undefined,
      browser_select_option: "nothing",
      browser_hover: "nothing",
      browser_drag: "nothing",
      browser_handle_dialog: undefined,
      browser_evaluate: undefined,
      browser_file_upload: "nothing",
    });
    // A dialog answered without words carries none of the model's.
    expect(
      (await effectsOf(website, "browser_handle_dialog", { accept: true }))
        ?.carries,
    ).toBe("nothing");
  });

  it("on the preview, reads the workspace page it acts on and brings nothing from outside, though the page's code may send what it is given", async () => {
    for (const [name, args] of actions)
      expect(await effectsOf(previewPage, name, args), name).toEqual({
        ...nothing,
        reads: "workspace",
        sends: "chosen",
        destination: previewOrigin,
        ...carried(name),
        brings: "none",
      });
  });

  it("reads the workspace for the files an upload sends", async () => {
    expect(
      await effectsOf(website, "browser_file_upload", {
        paths: ["invoice.pdf"],
      }),
    ).toEqual({
      ...nothing,
      reads: "workspace",
      sends: "chosen",
      destination: "https://shop.example",
      brings: "outside",
    });
  });
});

describe("what reading the open page declares", () => {
  const reads: readonly [string, Record<string, unknown>][] = [
    ["browser_snapshot", {}],
    ["browser_take_screenshot", {}],
    ["browser_console_messages", {}],
    ["browser_network_requests", {}],
    ["browser_wait_for", { text: "Paid" }],
  ];

  it("sends nothing and brings back what the site wrote", async () => {
    for (const [name, args] of reads)
      expect(await effectsOf(website, name, args), name).toEqual({
        ...nothing,
        brings: "outside",
      });
  });

  it("on the preview, reads the workspace and brings nothing from outside", async () => {
    for (const [name, args] of reads)
      expect(await effectsOf(previewPage, name, args), name).toEqual({
        ...nothing,
        reads: "workspace",
      });
  });
});

describe("what the browser window and the preview declare", () => {
  it("resizes the window to sizes the model chose, which the page can read, and brings back what the site shows", async () => {
    expect(
      await effectsOf(website, "browser_resize", { width: 390, height: 844 }),
    ).toEqual({
      ...nothing,
      sends: "chosen",
      destination: "https://shop.example",
      brings: "outside",
    });
    expect(
      await effectsOf(previewPage, "browser_resize", {
        width: 390,
        height: 844,
      }),
    ).toEqual({
      ...nothing,
      reads: "workspace",
      sends: "chosen",
      destination: previewOrigin,
    });
  });

  it("resizes a window with no page in it, or a blank one, sending nothing and bringing nothing", async () => {
    for (const page of ["", "about:blank"])
      expect(
        await effectsOf(page, "browser_resize", { width: 390, height: 844 }),
        page || "no page",
      ).toEqual(nothing);
  });

  it("still sends the model's code to wherever it reaches when it runs on a blank page", async () => {
    expect(
      await effectsOf("about:blank", "browser_evaluate", {
        function: "() => fetch('https://anywhere.example')",
      }),
    ).toMatchObject({ sends: "chosen", runs: "sealed" });
  });

  it("declares nothing for closing the browser or stopping the preview", async () => {
    for (const page of [website, previewPage])
      for (const name of ["browser_close", "browser_stop_preview"])
        expect(await effectsOf(page, name, {}), name).toEqual(nothing);
  });

  it("reads the workspace to open the preview, whose own code may send anything anywhere", async () => {
    expect(
      await effectsOf(website, "browser_preview", { path: "site/index.html" }),
    ).toEqual({ ...nothing, reads: "workspace", sends: "chosen" });
  });
});

/**
 * A browser whose network holds the preview (ADR 0018): once its page asks
 * for the preview, it reaches only the preview and the addresses allowed for
 * it, so what a call on the preview can send depends on what was allowed.
 */
const held = (
  url: string,
  network: { sealed: boolean; allowed: readonly string[] },
) => showing(url, { previewNetwork: () => network });

async function heldEffectsOf(
  page: string,
  network: { sealed: boolean; allowed: readonly string[] },
  name: string,
  args: Record<string, unknown>,
) {
  const inspection = await inspectBrowser(held(page, network), name, args);
  if (!inspection.ok) throw new Error(`${name}: ${inspection.reason}`);
  return inspection.effects;
}

describe("what a call on a held preview declares", () => {
  const closed = { sealed: true, allowed: [] };
  const fonts = { sealed: true, allowed: ["https://fonts.gstatic.com:443"] };

  it("sends nothing anywhere when nothing is allowed, whatever it carries", async () => {
    for (const [name, args] of [
      ["browser_click", { element: "the button", target: "e1" }],
      ["browser_type", { element: "the box", target: "e2", text: "notes" }],
      ["browser_resize", { width: 390, height: 844 }],
    ] as const)
      expect(
        await heldEffectsOf(previewPage, closed, name, args),
        name,
      ).toEqual({ ...nothing, reads: "workspace" });
    expect(
      await heldEffectsOf(previewPage, closed, "browser_evaluate", {
        function: "() => document.title",
      }),
    ).toEqual({ ...nothing, reads: "workspace", runs: "sealed" });
  });

  it("may send to the addresses allowed what the model wrote, once any is allowed", async () => {
    expect(
      await heldEffectsOf(previewPage, fonts, "browser_evaluate", {
        function: "() => document.title",
      }),
    ).toEqual({
      ...nothing,
      reads: "workspace",
      sends: "chosen",
      runs: "sealed",
      destination: previewOrigin,
    });
    expect(
      (
        await heldEffectsOf(previewPage, fonts, "browser_click", {
          element: "the button",
          target: "e1",
        })
      )?.carries,
    ).toBe("nothing");
  });

  it("opens the preview sending nothing, while nothing is allowed", async () => {
    const free = { sealed: false, allowed: [] };
    expect(
      await heldEffectsOf(website, free, "browser_preview", {
        path: "site/index.html",
      }),
    ).toEqual({ ...nothing, reads: "workspace" });
    expect(
      await heldEffectsOf(website, free, "browser_navigate", {
        url: `${previewOrigin}/token/other.html`,
      }),
    ).toEqual({ ...nothing, reads: "workspace" });
  });

  it("opens the preview as a send of what its code holds, once an address is allowed", async () => {
    expect(
      await heldEffectsOf(
        website,
        { sealed: false, allowed: fonts.allowed },
        "browser_preview",
        { path: "site/index.html" },
      ),
    ).toEqual({ ...nothing, reads: "workspace", sends: "chosen" });
  });

  it("acts on a website as before, the network holding nothing", async () => {
    expect(
      await heldEffectsOf(
        website,
        { sealed: false, allowed: [] },
        "browser_click",
        { element: "the button", target: "e1" },
      ),
    ).toEqual({
      ...nothing,
      sends: "chosen",
      destination: "https://shop.example",
      carries: "nothing",
      brings: "outside",
    });
  });

  it("allows addresses as a send of what the preview holds to addresses the model wrote", async () => {
    expect(
      await heldEffectsOf(previewPage, closed, "browser_allow_addresses", {
        addresses: ["https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
      }),
    ).toEqual({ ...nothing, reads: "workspace", sends: "chosen" });
  });

  it("names every address in the question, and refuses one that is not an origin", async () => {
    const asked = await inspectBrowser(
      held(previewPage, closed),
      "browser_allow_addresses",
      { addresses: ["https://fonts.gstatic.com", "https://cdn.jsdelivr.net"] },
    );
    expect(asked).toMatchObject({
      ok: true,
      target: "https://fonts.gstatic.com:443, https://cdn.jsdelivr.net:443",
    });

    expect(
      await inspectBrowser(
        held(previewPage, closed),
        "browser_allow_addresses",
        {
          addresses: ["https://cdn.jsdelivr.net/npm/chart.js"],
        },
      ),
    ).toMatchObject({ ok: false, correctable: true });
  });
});
