// @vitest-environment node
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { URL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BrowserContext } from "playwright-core";
import {
  BrowserSession,
  playwrightBrowserLauncher,
} from "@zhiyin/interactive-browser";
import { openProcessContainer } from "@zhiyin/process-ownership";
import { describe, expect, it } from "vitest";
import {
  BrowserPanel,
  BrowserSurface,
} from "../src/renderer/ui/browser/index.js";
import { WorkspaceSplit } from "../src/renderer/ui/workspace/index.js";
import { ApprovalPrompt } from "../src/renderer/ui/actions/index.js";

const launcher = playwrightBrowserLauncher({ open: openProcessContainer });
const availability = await launcher.available();

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (alive(pid)) {
    if (Date.now() > deadline)
      throw new Error("The structurally contained browser did not exit.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

it("starts the production browser through structural containment", () => {
  expect(availability).toEqual({
    available: true,
    browserName: expect.any(String),
  });
});

it.runIf(availability.available)(
  "closes the structurally contained browser before returning",
  async () => {
    const target = await launcher.launch({ width: 400, height: 300 });
    const pid = target.pid;
    expect(typeof pid).toBe("number");

    await target.close();
    await waitForExit(pid as number);
  },
  30_000,
);

async function openBrowser(width: number, height: number, url: string) {
  const browser = new BrowserSession({
    launcher,
    viewport: { width, height },
  });
  await browser.open(url);
  const deadline = Date.now() + 20_000;
  while (!browser.lastFrame()) {
    if (Date.now() > deadline)
      throw new Error("The production browser session produced no frame.");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return browser;
}

describe.runIf(availability.available)("browser frames in the renderer", () => {
  it("keeps the browser image fixed when an approval arrives in the split conversation", async () => {
    const target = await openBrowser(
      1280,
      800,
      "data:text/html,<h1>Browser workspace</h1>",
    );
    const server = createServer();
    try {
      const frame = target.lastFrame()!;
      const stylesheets = [
        "../src/renderer/styles.css",
        ...(
          await readdir(new URL("../src/renderer/ui/", import.meta.url), {
            recursive: true,
          })
        )
          .filter((name) => name.endsWith(".css"))
          .map((name) => `../src/renderer/ui/${name.replaceAll("\\", "/")}`),
      ];
      const styles = (
        await Promise.all(
          stylesheets.map((path) =>
            readFile(new URL(path, import.meta.url), "utf8"),
          ),
        )
      )
        .join("\n")
        .replace(/@import\s+[^;]+;/g, "")
        // Module stylesheets read as plain CSS. Rendered here, a module's
        // classes keep their written names, so only :global() needs undoing.
        .replace(/:global\(([^()]*)\)/g, "$1");
      const template = await readFile(
        new URL("../src/renderer/index.html", import.meta.url),
        "utf8",
      );
      let approval = false;
      server.on("request", (_request, response) => {
        const browser = {
          status: "open" as const,
          title: "Browser workspace",
          url: "https://example.com",
          loading: false,
          frame,
        };
        const workspace = renderToStaticMarkup(
          createElement(WorkspaceSplit<typeof browser>, {
            shows: browser,
            render: (shown) =>
              createElement(BrowserSurface, {
                browser: shown,
                onDrive: () => undefined,
                onReturn: () => undefined,
              }),
            split: true,
            id: "layout",
            children: [
              createElement(
                "div",
                { className: "workspace-view", key: "conversation" },
                createElement(
                  "div",
                  { className: "thread-scroll thread-scroll--compact" },
                  "Checking the page.",
                ),
              ),
              createElement(
                "div",
                {
                  className: "composer-dock composer-dock--compact",
                  key: "dock",
                },
                approval
                  ? createElement(
                      "div",
                      { className: "composer-dock__decision" },
                      createElement(ApprovalPrompt, {
                        title: "Read page",
                        target: "Zhiyin’s browser",
                        command: "browser_snapshot({})",
                        detail: "Reads the current page in Zhiyin’s browser.",
                        compact: true,
                        onDecision: () => undefined,
                      }),
                    )
                  : null,
              ),
            ],
          }),
        );
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(
          template
            .replace("</head>", `<style>${styles}</style></head>`)
            .replace(
              '<div id="root"></div>',
              `<div id="root"><main class="thread-view" style="height:100%">${workspace}</main></div>`,
            )
            .replace('<script type="module" src="./main.tsx"></script>', ""),
        );
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No port");
      const page = (target.automation() as BrowserContext).pages()[0];
      if (!page) throw new Error("No browser page");
      for (const viewport of [
        { width: 1672, height: 966 },
        { width: 720, height: 480 },
      ]) {
        await page.setViewportSize(viewport);
        approval = false;
        await target.navigate(`http://127.0.0.1:${address.port}`);
        const image = page.locator("img.browser-panel__view");
        await image.evaluate((element) =>
          (element as HTMLImageElement).decode(),
        );
        const before = await image.boundingBox();
        expect(before).not.toBeNull();
        expect(before!.width).toBeGreaterThan(viewport.width * 0.4);
        expect(before!.width / before!.height).toBeCloseTo(
          frame.width / frame.height,
          1,
        );
        approval = true;
        await target.navigate(`http://127.0.0.1:${address.port}`);
        await image.evaluate((element) =>
          (element as HTMLImageElement).decode(),
        );
        expect(await image.boundingBox()).toEqual(before);
        const prompt = await page
          .getByRole("region", { name: "Permission request" })
          .boundingBox();
        expect(prompt).not.toBeNull();
        expect(prompt!.x).toBeGreaterThanOrEqual(before!.x + before!.width);
        expect(prompt!.x + prompt!.width).toBeLessThanOrEqual(viewport.width);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(viewport.width);
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await target.close();
    }
  }, 120_000);

  it("decodes a captured browser frame under the production security policy while blocking inline scripts", async () => {
    const target = await openBrowser(
      400,
      300,
      "data:text/html,<h1>Live browser frame</h1>",
    );
    const server = createServer();
    try {
      const frame = target.lastFrame()!;
      const panel = renderToStaticMarkup(
        createElement(BrowserPanel, {
          browser: {
            status: "open",
            title: "Live browser frame",
            url: "about:blank",
            loading: false,
            frame,
          },
          onDrive: () => undefined,
        }),
      );
      const template = await readFile(
        new URL("../src/renderer/index.html", import.meta.url),
        "utf8",
      );
      const html = template
        .replace('<div id="root"></div>', `<div id="root">${panel}</div>`)
        .replace(
          '<script type="module" src="./main.tsx"></script>',
          '<script>document.documentElement.dataset.inlineScriptRan="yes"</script>',
        );
      server.on("request", (_request, response) => {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(html);
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No port");
      await target.navigate(`http://127.0.0.1:${address.port}`);
      const context = target.automation() as BrowserContext;
      const page = context.pages()[0];
      if (!page) throw new Error("No browser page");
      expect(
        await page.locator("html").getAttribute("data-inline-script-ran"),
      ).toBeNull();
      const size = await page
        .locator("img.browser-panel__view")
        .evaluate(async (element) => {
          const image = element as HTMLImageElement;
          await image.decode();
          return { width: image.naturalWidth, height: image.naturalHeight };
        });
      expect(size).toEqual({ width: frame.width, height: frame.height });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await target.close();
    }
  }, 120_000);
});
