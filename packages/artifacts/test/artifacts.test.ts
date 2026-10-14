import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TaskArtifact } from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { WorkspaceArtifacts } from "../src/index.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

async function workspace(files: Record<string, string> = {}): Promise<string> {
  const root = await folders.make("zhiyin-artifacts-");
  for (const [path, text] of Object.entries(files))
    await writeFile(join(root, path), text, "utf8");
  return root;
}

function artifact(overrides: Partial<TaskArtifact> = {}): TaskArtifact {
  return {
    path: "brief.md",
    name: "brief.md",
    change: "created",
    bytes: 5,
    updatedAt: "2026-09-05T10:00:00.000Z",
    ...overrides,
  };
}

describe("WorkspaceArtifacts", () => {
  it("keeps one record per file and remembers how the task first touched it", () => {
    const artifacts = new WorkspaceArtifacts(() => undefined);

    const first = artifacts.record(
      [],
      [
        { path: "notes.md", change: "updated", bytes: 10 },
        { path: "reports/brief.md", change: "created", bytes: 20 },
      ],
      new Date("2026-09-05T10:00:00.000Z"),
    );
    expect(first).toEqual([
      {
        path: "reports/brief.md",
        name: "brief.md",
        change: "created",
        bytes: 20,
        updatedAt: "2026-09-05T10:00:00.000Z",
      },
      {
        path: "notes.md",
        name: "notes.md",
        change: "updated",
        bytes: 10,
        updatedAt: "2026-09-05T10:00:00.000Z",
      },
    ]);

    const second = artifacts.record(
      first,
      [{ path: "notes.md", change: "created", bytes: 44 }],
      new Date("2026-09-05T11:00:00.000Z"),
    );
    expect(second).toEqual([
      {
        path: "notes.md",
        name: "notes.md",
        change: "updated",
        bytes: 44,
        updatedAt: "2026-09-05T11:00:00.000Z",
      },
      first[0],
    ]);
  });

  it("reads a produced file for review and says when it was shortened", async () => {
    const long = "x".repeat(30_000);
    const root = await workspace({ "brief.md": long });
    const artifacts = new WorkspaceArtifacts(() => root);

    await expect(
      artifacts.preview(artifact({ bytes: long.length })),
    ).resolves.toMatchObject({
      status: "ready",
      text: "x".repeat(20_000),
      truncated: true,
    });

    await writeFile(join(root, "brief.md"), "Short.", "utf8");
    await expect(artifacts.preview(artifact())).resolves.toMatchObject({
      status: "ready",
      text: "Short.",
      truncated: false,
    });
  });

  it("reports a produced file that is gone instead of an empty preview", async () => {
    const root = await workspace({ "brief.md": "Draft" });
    const artifacts = new WorkspaceArtifacts(() => root);
    await rm(join(root, "brief.md"));

    await expect(artifacts.preview(artifact())).resolves.toEqual({
      status: "missing",
      path: "brief.md",
      reason:
        "brief.md is no longer in the workspace. It may have been moved, renamed, or deleted outside Zhiyin.",
    });
  });

  it("does not read a produced file that is not text", async () => {
    const root = await workspace();
    await writeFile(join(root, "brief.md"), Buffer.from([0x50, 0x00, 0x4b]));
    const artifacts = new WorkspaceArtifacts(() => root);

    await expect(artifacts.preview(artifact())).resolves.toMatchObject({
      status: "unreadable",
      reason:
        "brief.md is not a text file, so it cannot be shown here. Export it to open it in another app.",
    });
  });

  it("refuses a recorded path that leaves the workspace", async () => {
    const parent = await folders.make("zhiyin-artifacts-");
    const root = join(parent, "inside");
    await mkdir(root);
    await writeFile(join(parent, "secret.md"), "outside", "utf8");
    const artifacts = new WorkspaceArtifacts(() => root);
    const escaping = artifact({ path: "../secret.md", name: "secret.md" });

    await expect(artifacts.preview(escaping)).resolves.toMatchObject({
      status: "unreadable",
      reason: "This file is not inside the current workspace.",
    });
    await expect(
      artifacts.exportTo(escaping, async () => join(parent, "copy.md")),
    ).resolves.toEqual({
      status: "failed",
      reason: "This file is not inside the current workspace.",
    });
  });

  it("says a preview is unavailable when no folder is selected", async () => {
    const artifacts = new WorkspaceArtifacts(() => undefined);

    await expect(artifacts.preview(artifact())).resolves.toMatchObject({
      status: "unreadable",
      reason: "No folder is selected, so this file cannot be opened.",
    });
  });

  it("copies a produced file to the chosen destination and reports a cancelled choice", async () => {
    const root = await workspace({ "brief.md": "Final draft" });
    const outside = await folders.make("zhiyin-export-");
    const artifacts = new WorkspaceArtifacts(() => root);
    const destination = join(outside, "brief.md");

    const suggestions: string[] = [];
    await expect(
      artifacts.exportTo(artifact(), async (name) => {
        suggestions.push(name);
        return destination;
      }),
    ).resolves.toEqual({ status: "saved", destination });
    expect(suggestions).toEqual(["brief.md"]);
    await expect(readFile(destination, "utf8")).resolves.toBe("Final draft");

    await expect(
      artifacts.exportTo(artifact(), async () => undefined),
    ).resolves.toEqual({ status: "cancelled" });
  });

  it("reports a failed export instead of claiming the file was saved", async () => {
    const root = await workspace({ "brief.md": "Final draft" });
    const outside = await folders.make("zhiyin-export-");
    const artifacts = new WorkspaceArtifacts(() => root);

    await expect(
      artifacts.exportTo(artifact(), async () =>
        join(outside, "absent-folder", "brief.md"),
      ),
    ).resolves.toEqual({
      status: "failed",
      reason:
        "brief.md could not be saved to that location. Check that the folder exists and allows changes.",
    });

    await rm(join(root, "brief.md"));
    await expect(
      artifacts.exportTo(artifact(), async () => join(outside, "copy.md")),
    ).resolves.toEqual({
      status: "failed",
      reason:
        "brief.md is no longer in the workspace. It may have been moved, renamed, or deleted outside Zhiyin.",
    });
  });

  it("owns explicit SVG view export and rejects active content", async () => {
    const outside = await folders.make("zhiyin-view-export-");
    const destination = join(outside, "release-flow.svg");
    const artifacts = new WorkspaceArtifacts(() => undefined);

    await expect(
      artifacts.exportView(
        "Release flow",
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
        async () => destination,
      ),
    ).resolves.toEqual({ status: "saved", destination });
    await expect(readFile(destination, "utf8")).resolves.toContain("<rect");

    await expect(
      artifacts.exportView(
        "Unsafe",
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        async () => join(outside, "unsafe.svg"),
      ),
    ).resolves.toMatchObject({ status: "failed" });
  });

  it("saves a diagram made of what a still picture is made of", async () => {
    const outside = await folders.make("zhiyin-view-export-");
    const artifacts = new WorkspaceArtifacts(() => undefined);
    // As the window saves a flowchart: its own stylesheet, markers, a
    // gradient, a shadow filter, and colours carried as inline style.
    const diagram = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80" role="graphics-document document" aria-roledescription="flowchart-v2">',
      "<style>#d{font-family:Inter,sans-serif;}#d .node > rect{fill:#202624;}#d .edge{marker-end:url(#d-pointEnd);}</style>",
      '<defs><marker id="d-pointEnd" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z"/></marker>',
      '<linearGradient id="d-gradient" gradientUnits="objectBoundingBox"><stop offset="0%" stop-color="#202624"/></linearGradient>',
      '<filter id="d-drop"><feDropShadow dx="1" dy="1" stdDeviation="2" flood-color="#000" flood-opacity="0.2"/></filter></defs>',
      '<g class="node" transform="translate(40, 40)" data-id="A"><rect x="-30" y="-15" width="60" height="30" style="fill: url(&quot;#d-gradient&quot;); stroke: rgb(83, 98, 93);"/>',
      '<text text-anchor="middle" dominant-baseline="middle"><tspan x="0" dy="0.3em">Start &amp; go</tspan></text></g>',
      '<path class="edge" d="M70,40L130,40" marker-end="url(#d-pointEnd)"/><title>Release flow</title>',
      "</svg>",
    ].join("");

    await expect(
      artifacts.exportView("Release flow", diagram, async () =>
        join(outside, "flow.svg"),
      ),
    ).resolves.toMatchObject({ status: "saved" });
  });

  it.each([
    [
      "an animation that turns a link into script",
      '<svg><a><animate attributeName="href" values="javascript:alert(1)"/><text>Go</text></a></svg>',
    ],
    [
      "an element a still picture has no use for",
      '<svg><set attributeName="fill" to="red"/></svg>',
    ],
    [
      "a picture fetched from elsewhere",
      '<svg><image href="https://example.com/x.png"/></svg>',
    ],
    [
      "a link out of the drawing",
      '<svg><use href="https://example.com/x.svg#a"/></svg>',
    ],
    [
      "a link written in character codes",
      '<svg><use href="&#106;avascript:alert(1)"/></svg>',
    ],
    [
      "a stylesheet that imports another",
      "<svg><style>@import url(https://example.com/x.css);</style></svg>",
    ],
    [
      "a style that fetches from elsewhere",
      '<svg><rect style="fill: url(https://example.com/x.svg#p)"/></svg>',
    ],
    [
      "a paint that fetches from elsewhere",
      '<svg><rect fill="url(https://example.com/x.svg#p)"/></svg>',
    ],
    [
      "a style written in escapes",
      '<svg><rect style="fill: u\\72l(https://example.com/p)"/></svg>',
    ],
    ["an event handler", '<svg onload="alert(1)"><rect/></svg>'],
    [
      "HTML inside the drawing",
      "<svg><foreignObject><div>Hi</div></foreignObject></svg>",
    ],
    [
      "a document type that declares entities",
      '<svg><!DOCTYPE svg [<!ENTITY a "b">]><rect/></svg>',
    ],
    [
      "a processing instruction",
      '<svg><?xml-stylesheet href="https://example.com/x.css"?><rect/></svg>',
    ],
    ["something that is not a drawing", "<html><svg></svg></html>"],
  ])("refuses to save %s", async (_case, svg) => {
    const outside = await folders.make("zhiyin-view-export-");
    const artifacts = new WorkspaceArtifacts(() => undefined);
    let asked = false;

    await expect(
      artifacts.exportView("Unsafe", svg, async () => {
        asked = true;
        return join(outside, "unsafe.svg");
      }),
    ).resolves.toEqual({
      status: "failed",
      reason:
        "The rendered image contains content that cannot be saved safely.",
    });
    expect(asked).toBe(false);
  });

  it("names an exported view's file from its title", async () => {
    const outside = await folders.make("zhiyin-view-name-");
    const artifacts = new WorkspaceArtifacts(() => undefined);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const offered: string[] = [];
    const save = async (suggested: string) => {
      offered.push(suggested);
      return join(outside, suggested);
    };

    await artifacts.exportView("Release flow — Q3 (draft)", svg, save);
    await artifacts.exportView("!!!", svg, save);

    expect(offered).toEqual(["release-flow-q3-draft.svg", "view.svg"]);
  });
});
