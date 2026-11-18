/**
 * The app is built without test code (ADR 0002): a build whose bundle takes
 * in a package's fakes, a file under a test folder or a test fails, naming
 * the file. Built with Vite, as the app is, over a small tree of files.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";
import { TemporaryFolders } from "@zhiyin/test-support";
import { refuseTestCode, testingEntriesIn } from "../no-test-code.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

/** A repository of these files, by their paths inside it. */
async function repository(files: Record<string, string>): Promise<string> {
  const root = await folders.make("zhiyin-no-test-code-");
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

/** Builds `src/app.js` as the app's builds are held, writing nothing. */
async function built(root: string): Promise<void> {
  await build({
    configFile: false,
    logLevel: "silent",
    root,
    build: {
      write: false,
      minify: false,
      lib: {
        entry: join(root, "src", "app.js"),
        formats: ["es"],
        fileName: () => "app.js",
      },
    },
    plugins: [
      refuseTestCode({
        root,
        testingEntries: testingEntriesIn(join(root, "packages")),
      }),
    ],
  });
}

const thing = {
  "packages/feature/thing/package.json": JSON.stringify({
    name: "@zhiyin/thing",
    exports: { ".": "./src/index.js", "./testing": "./fakes/entry.js" },
  }),
  "packages/feature/thing/src/index.js": "export const real = 1;\n",
  "packages/feature/thing/test/fakes.js": "export const fake = 2;\n",
  "packages/feature/thing/fakes/entry.js": "export const entry = 3;\n",
  "src/part.test.js": "export const checked = 4;\n",
};

describe("building the app", () => {
  it("builds code that takes in no test code", async () => {
    const root = await repository({
      ...thing,
      "src/app.js":
        'export { real } from "../packages/feature/thing/src/index.js";\n',
    });

    await expect(built(root)).resolves.toBeUndefined();
  });

  it.each([
    [
      "a file under a test folder",
      "packages/feature/thing/test/fakes.js",
      "fake",
    ],
    [
      "a package's testing entry",
      "packages/feature/thing/fakes/entry.js",
      "entry",
    ],
    ["a test", "src/part.test.js", "checked"],
  ])("fails when the bundle takes in %s, naming it", async (_, path, name) => {
    const root = await repository({
      ...thing,
      "src/app.js": `export { ${name} } from "../${path}";\n`,
    });

    await expect(built(root)).rejects.toThrow(
      `carries test code, which only tests may import (ADR 0002): ${path}.`,
    );
  });

  it("knows every testing entry the workspace publishes", () => {
    const packages = resolve(__dirname, "../../../packages");

    expect(testingEntriesIn(packages)).toEqual(
      expect.arrayContaining([
        resolve(packages, "loop/agent-loop/test/stubs.ts"),
        resolve(packages, "feature/recovery/test/fakes.ts"),
      ]),
    );
  });
});
