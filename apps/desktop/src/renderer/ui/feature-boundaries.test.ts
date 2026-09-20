import { readdirSync } from "node:fs";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const renderer = "apps/desktop/src/renderer";
const ui = `${renderer}/ui`;
const eslint = new ESLint();

/** What the path rules said about one import, written into one file. */
async function refusals(source: string, filePath: string) {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === "import-x/no-restricted-paths")
    .map((message) => message.message);
}

const moduleRule = "A module does not import another module";
const sharedRule = "Shared presentation holds neutral pieces";
const entryRule = (name: string) => `Use ${name} through its index.ts`;

// Runs the real linter over real source, which takes seconds on its own and
// longer under a loaded suite.
describe("renderer module boundaries", { timeout: 60_000 }, () => {
  it("rejects a module importing another module, even through its entry point", async () => {
    const found = await refusals(
      'import { Composer } from "../conversation/index.js"; void Composer;',
      `${ui}/actions/violation.ts`,
    );
    expect(found.some((message) => message.includes(moduleRule))).toBe(true);
  });

  it("rejects a module importing another module by its folder name", async () => {
    const found = await refusals(
      'import { Composer } from "../conversation"; void Composer;',
      `${ui}/actions/violation.ts`,
    );
    expect(found.some((message) => message.includes(moduleRule))).toBe(true);
  });

  it("rejects a module importing the app shell", async () => {
    const found = await refusals(
      'import { WorkspaceShell } from "../app/index.js"; void WorkspaceShell;',
      `${ui}/actions/violation.ts`,
    );
    expect(found.some((message) => message.includes(moduleRule))).toBe(true);
  });

  it("rejects the app shell reaching past a module's entry point", async () => {
    const found = await refusals(
      'import { WorkTrace } from "../conversation/WorkTrace.js"; void WorkTrace;',
      `${ui}/app/violation.ts`,
    );
    expect(
      found.some((message) => message.includes(entryRule("conversation"))),
    ).toBe(true);
  });

  it("rejects the renderer root reaching past a module's entry point", async () => {
    const found = await refusals(
      'import { parseChartData } from "./ui/views/chartData.js"; void parseChartData;',
      // Places are read from disk when the rules load, so this is a real file.
      "apps/desktop/src/renderer/App.tsx",
    );
    expect(found.some((message) => message.includes(entryRule("views")))).toBe(
      true,
    );
  });

  it("allows the app shell to use a module through its entry point", async () => {
    expect(
      await refusals(
        'import { Composer } from "../conversation/index.js"; void Composer;',
        `${ui}/app/allowed.ts`,
      ),
    ).toEqual([]);
  });

  it("allows a module to use shared presentation through its entry point", async () => {
    expect(
      await refusals(
        'import { Icon } from "../shared/index.js"; void Icon;',
        `${ui}/actions/allowed.ts`,
      ),
    ).toEqual([]);
  });

  it("rejects shared presentation depending on a module", async () => {
    const found = await refusals(
      'import { Composer } from "../conversation/index.js"; void Composer;',
      `${ui}/shared/violation.ts`,
    );
    expect(found.some((message) => message.includes(sharedRule))).toBe(true);
  });

  it("holds every folder of the renderer to the module entry points, including ones added later", async () => {
    const folders = readdirSync(renderer, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "ui")
      .map((entry) => entry.name)
      // A folder of images imports nothing; the rules are about code.
      .filter((name) =>
        readdirSync(`${renderer}/${name}`, { recursive: true }).some((entry) =>
          /\.tsx?$/.test(String(entry)),
        ),
      );
    const unguarded: string[] = [];
    for (const name of folders) {
      const found = await refusals(
        'import { WorkTrace } from "../ui/conversation/WorkTrace.js"; void WorkTrace;',
        `${renderer}/${name}/violation.ts`,
      );
      if (!found.some((message) => message.includes(entryRule("conversation"))))
        unguarded.push(name);
    }
    expect(unguarded).toEqual([]);
  });

  it("rejects the window importing main-process or bridge code", async () => {
    for (const path of [
      "../../../main/composition.js",
      "../../../preload/index.js",
    ]) {
      expect(
        await refusals(`import "${path}";`, `${ui}/actions/violation.ts`),
      ).not.toEqual([]);
    }
  });

  it("rejects the main process importing the window's own code", async () => {
    const found = await refusals(
      'import { App } from "../renderer/App.js"; void App;',
      "apps/desktop/src/main/violation.ts",
    );
    expect(found).not.toEqual([]);
  });

  it("holds every folder under ui to the module rule, including ones added later", async () => {
    const modules = readdirSync(ui, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name !== "app" && name !== "shared");
    const unguarded: string[] = [];
    for (const [index, name] of modules.entries()) {
      const other = modules[(index + 1) % modules.length];
      const found = await refusals(
        `import * as other from "../${other}/index.js"; void other;`,
        `${ui}/${name}/violation.ts`,
      );
      if (!found.some((message) => message.includes(moduleRule)))
        unguarded.push(name);
    }
    expect(unguarded).toEqual([]);
  });
});
