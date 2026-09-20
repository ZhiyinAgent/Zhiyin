// @vitest-environment node
/**
 * A page's layout is its own, whichever order the stylesheets load in.
 *
 * CSS Modules keep class names apart; they do not decide which rule wins when
 * two modules set the same property on the same element at the same weight.
 * Then the answer is the load order, which nothing here controls (ADR 0035).
 * Measured in a real browser, with the stylesheets served in both orders.
 */

import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { URL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BrowserContext } from "playwright-core";
import type { PluginState } from "@zhiyin/contract";
import { playwrightBrowserLauncher } from "@zhiyin/interactive-browser";
import { openProcessContainer } from "@zhiyin/process-ownership";
import { describe, expect, it } from "vitest";
import { CapabilityLibrary } from "../src/renderer/ui/capabilities/index.js";
import { UsagePanel } from "../src/renderer/ui/usage/index.js";

const launcher = playwrightBrowserLauncher({ open: openProcessContainer });
const availability = await launcher.available();

const plugin: PluginState = {
  id: "software-engineering",
  name: "Software Engineering",
  version: "1.0.0",
  description: "Build, test, and review software.",
  category: "Development",
  publisher: "Zhiyin",
  source: "built-in",
  rollbackAvailable: false,
  enabled: true,
  status: "partial",
  defaultPrompts: [],
  editing: "override",
  components: [
    {
      id: "engineering/test-driven-development",
      kind: "skill",
      name: "test-driven-development",
      description: "Change and verify software.",
      enabled: true,
      status: "ready",
      editing: "override",
    },
  ],
};

async function stylesheetPaths(): Promise<string[]> {
  return [
    "../src/renderer/styles.css",
    ...(
      await readdir(new URL("../src/renderer/ui/", import.meta.url), {
        recursive: true,
      })
    )
      .map(String)
      .filter((name) => name.endsWith(".css"))
      .map((name) => `../src/renderer/ui/${name.replaceAll("\\", "/")}`),
  ];
}

async function styleText(paths: readonly string[]): Promise<string> {
  const sheets = await Promise.all(
    paths.map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );
  return (
    sheets
      .join("\n")
      .replace(/@import\s+[^;]+;/g, "")
      // Module stylesheets read as plain CSS here, so their classes keep the
      // names they are written with; only :global() needs undoing.
      .replace(/:global\(([^()]*)\)/g, "$1")
  );
}

const page = () =>
  [
    renderToStaticMarkup(
      createElement(CapabilityLibrary, {
        plugins: [plugin],
        onClose: () => undefined,
        onTogglePlugin: async () => undefined,
        onInstallPlugin: async () => ({ status: "cancelled" as const }),
        onUpdatePlugin: async () => ({ status: "cancelled" as const }),
        onRollbackPlugin: async () => undefined,
        onRemovePlugin: async () => undefined,
        onCreatePlugin: async () => undefined,
        onLoadEditableContents: async () => undefined,
        onSavePluginContents: async () => undefined,
        onToggleComponent: async () => undefined,
        onLoadComponentContent: async () => undefined,
        onOverrideComponent: async () => undefined,
        onResetComponent: async () => undefined,
        onInstallToolchain: async () => undefined,
        onTestConnection: async () => ({ ok: false as const, reason: "" }),
        onSetConnectionToolEnabled: async () => undefined,
        onSaveConnectionToken: async () => undefined,
        onClearConnectionToken: async () => undefined,
        onRefreshConnections: async () => undefined,
        onCheckShell: async () => ({ available: true as const }),
        onRecheckShell: async () => ({ available: true as const }),
        onOpenExternalUrl: async () => undefined,
      }),
    ),
    renderToStaticMarkup(
      createElement(UsagePanel, {
        availability: {
          status: "unavailable" as const,
          reason: "No usage yet.",
        },
        onClose: () => undefined,
      }),
    ),
  ].join("");

describe.runIf(availability.available)("page frames in the renderer", () => {
  it(
    "keeps each page's own layout whichever order the stylesheets load in",
    { timeout: 120_000 },
    async () => {
      const target = await launcher.launch({ width: 1280, height: 800 });
      const server = createServer();
      try {
        const paths = await stylesheetPaths();
        const template = await readFile(
          new URL("../src/renderer/index.html", import.meta.url),
          "utf8",
        );
        let styles = "";
        server.on("request", (_request, response) => {
          response.writeHead(200, { "Content-Type": "text/html" });
          response.end(
            template
              .replace("</head>", `<style>${styles}</style></head>`)
              .replace(
                '<div id="root"></div>',
                `<div id="root">${page()}</div>`,
              )
              .replace('<script type="module" src="./main.tsx"></script>', ""),
          );
        });
        await new Promise<void>((resolve) =>
          server.listen(0, "127.0.0.1", resolve),
        );
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("No port");
        const open = (target.automation() as BrowserContext).pages()[0];
        if (!open) throw new Error("No browser page");

        for (const order of ["as written", "reversed"] as const) {
          styles = await styleText(
            order === "reversed" ? [...paths].reverse() : paths,
          );
          await target.goto(`http://127.0.0.1:${address.port}`);

          // The capability pages hold their own scrolling; the usage page
          // scrolls as a whole.
          expect(
            await open
              .locator('section[aria-label="Plugins"]')
              .evaluate((element) => getComputedStyle(element).overflowY),
          ).toBe("hidden");
          expect(
            await open
              .locator('section[aria-label="Usage overview"]')
              .evaluate((element) => getComputedStyle(element).overflowY),
          ).toBe("auto");
          // The plugin page keeps directory and details in two readable lanes.
          expect(
            await open
              .locator('[class~="plugin-layout"]')
              .evaluate(
                (element) =>
                  getComputedStyle(element).gridTemplateColumns.split(" ")
                    .length,
              ),
          ).toBe(2);
        }
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await target.close();
      }
    },
  );
});
