/**
 * The window asks for a workspace file to be opened in Windows' own app. The
 * rule of what may be opened is the document viewer's; here it is the real
 * one, on real files, so the request is judged as the app judges it.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CHANNEL } from "@zhiyin/contract";
import { DocumentViewer } from "@zhiyin/document-viewer";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { Core } from "../../src/index.js";
import { loopFrom, stubDependencies } from "./support.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

async function appIn(root: string) {
  const deps = stubDependencies(() => {});
  const app = loopFrom({
    ...deps,
    // Drawing is never reached: opening a file in its own app draws nothing.
    documents: new DocumentViewer({
      start: () => {
        throw new Error("Nothing is drawn here.");
      },
      containment: {
        open: () => {
          throw new Error("Nothing is drawn here.");
        },
      } as unknown as ConstructorParameters<
        typeof DocumentViewer
      >[0]["containment"],
    }),
    workspace: {
      ...deps.workspace,
      selectWorkspace: async () => {},
      describeWorkspace: async () => ({
        rootName: "work",
        entries: [],
        truncated: false,
      }),
    },
  });
  await app.initialize();
  const taskId = await app.createTask();
  await app.selectWorkspace(root);
  const opened: string[] = [];
  const core = new Core({
    workspace: app,
    ownership: { claim: async () => {}, release: async () => {} },
    viewChecks: { answer: () => {}, abandon: () => {} },
    commands: {
      runningCommands: () => [],
      commandOutput: async () => undefined,
      stopCommandForPerson: async () => {},
      onCommandsChanged: () => {},
    },
    chooseFolder: async () => undefined,
    chooseSaveLocation: async () => undefined,
    openExternal: async () => {},
    openPath: async (path) => void opened.push(path),
    showInFolder: async () => {},
    dataFolder: join(root, "..", "data"),
    version: "1.0.0",
  });
  const open = (path: string) =>
    core.receive(CHANNEL.openDocument, [taskId, path]);
  return { open, opened };
}

describe("a workspace file opened in its own app", () => {
  it("opens documents and pictures, and nothing Windows could run", async () => {
    const parent = await folders.make("zhiyin-open-own-app-");
    const root = join(parent, "work");
    await mkdir(join(root, "reports"), { recursive: true });
    for (const name of [
      "reports/q3.PDF",
      "reports/chart.png",
      "reports/plan.docx",
      "setup.exe",
      "report.pdf.exe",
      "run.bat",
      "page.html",
      "notes.lnk",
    ])
      await writeFile(join(root, name), "content");
    await writeFile(join(parent, "secret.pdf"), "outside");
    const { open, opened } = await appIn(root);

    for (const path of [
      "reports/q3.PDF",
      "reports/chart.png",
      "reports/plan.docx",
    ])
      await open(path);
    for (const path of [
      "setup.exe",
      "report.pdf.exe",
      "run.bat",
      "page.html",
      "notes.lnk",
    ])
      await expect(open(path), path).rejects.toThrow(
        "Zhiyin opens only PDFs, pictures, and Word, Excel or PowerPoint files in their own app.",
      );
    await expect(open("../secret.pdf")).rejects.toThrow(
      "outside the folder this conversation works in",
    );
    await expect(open("reports/missing.pdf")).rejects.toThrow();

    expect(opened).toEqual(
      ["reports/q3.PDF", "reports/chart.png", "reports/plan.docx"].map((path) =>
        join(root, path),
      ),
    );
  });
});
