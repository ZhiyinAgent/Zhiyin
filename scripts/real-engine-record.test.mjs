import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  changesThatCount,
  engineFiles,
  loadsFingerprint,
  reachedFiles,
  recordProblems,
  recorded,
  runCounts,
} from "./real-engine-record.mjs";

const blenderFile =
  "packages/feature/blender-studio/system-boundary/real-blender.test.ts";
const cadFile = "packages/feature/cad-studio/system-boundary/real-cad.test.ts";
const bothFile = "apps/desktop/system-boundary/scene-drawing.test.ts";

const files = new Map([
  [blenderFile, ["blender"]],
  [cadFile, ["build123d"]],
  [bothFile, ["blender", "build123d"]],
]);

const pins = { blender: "5.2.2", build123d: "0.13.0" };
const versions = pins;
const at = "2026-11-13T22:00:00.000Z";

const ran = (state) => ({ result: () => ({ state }) });
const module = (moduleId, ...states) => ({
  moduleId,
  children: { allTests: () => states.map(ran) },
});

/**
 * A record in which every real-engine file ran whole and passed on `commit`,
 * with the files it loaded as `loads` names them.
 */
function passingRecord(commit, loads) {
  return recorded(
    {},
    new Map(
      [...files.keys()].map((f) => [f, { passed: 3, failed: 0, skipped: 0 }]),
    ),
    files,
    {
      commit,
      ...(loads === undefined ? {} : { loads }),
      versions,
      at,
    },
  );
}

describe("the files that need a real engine", () => {
  it("are the skip list's files that need Blender or the CAD environment, with the engines each needs", () => {
    const expected = new Map([
      [
        blenderFile,
        { needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)" },
      ],
      [cadFile, { needs: "the CAD environment's Python (ZHIYIN_CAD_PYTHON)" }],
      [
        bothFile,
        {
          needs:
            "Blender on a PC with a graphics card and the CAD environment's Python (ZHIYIN_BLENDER, ZHIYIN_CAD_PYTHON)",
        },
      ],
      [
        "apps/desktop/system-boundary/blender-install.test.ts",
        { needs: "Blender's archive (ZHIYIN_BLENDER_ARCHIVE)" },
      ],
      [
        "packages/feature/python-sandbox/test/real-uv.test.ts",
        { needs: "uv (ZHIYIN_UV)" },
      ],
    ]);
    expect(engineFiles(expected)).toEqual(files);
  });
});

describe("what a run counts", () => {
  it("is each file's passed, failed and skipped tests, by its path from the repository", () => {
    expect(
      runCounts(
        [
          module(
            `C:/repo/${blenderFile}`,
            "passed",
            "passed",
            "failed",
            "skipped",
          ),
          module("C:/repo/packages/feature/tools/test/a.test.ts", "passed"),
        ],
        "C:/repo",
      ),
    ).toEqual(
      new Map([
        [blenderFile, { passed: 2, failed: 1, skipped: 1 }],
        [
          "packages/feature/tools/test/a.test.ts",
          { passed: 1, failed: 0, skipped: 0 },
        ],
      ]),
    );
  });
});

describe("writing the record", () => {
  it("keeps, for each real-engine file that ran, the commit, the engines it needs and its counts", () => {
    const record = recorded(
      {},
      new Map([
        [blenderFile, { passed: 5, failed: 0, skipped: 0 }],
        [
          "packages/feature/tools/test/a.test.ts",
          { passed: 1, failed: 0, skipped: 0 },
        ],
      ]),
      files,
      { commit: "c1", versions, at },
    );
    expect(record).toEqual({
      [blenderFile]: {
        commit: "c1",
        ran: at,
        passed: 5,
        failed: 0,
        skipped: 0,
        blender: "5.2.2",
      },
    });
  });

  it("keeps, beside the commit, the fingerprint of the files the run loaded", () => {
    expect(passingRecord("abc123", "fingerprint")[cadFile]).toMatchObject({
      commit: "abc123",
      loads: "fingerprint",
    });
  });

  it("leaves a file's entry as it was when none of its tests ran", () => {
    const before = passingRecord("c1");
    const after = recorded(
      before,
      new Map([[cadFile, { passed: 0, failed: 0, skipped: 40 }]]),
      files,
      { commit: "c2", versions: {}, at },
    );
    expect(after).toEqual(before);
  });

  it("replaces a file's entry with the latest run, failures included", () => {
    const after = recorded(
      passingRecord("c1"),
      new Map([[cadFile, { passed: 38, failed: 2, skipped: 0 }]]),
      files,
      { commit: "c2", versions, at },
    );
    expect(after[cadFile]).toEqual({
      commit: "c2",
      ran: at,
      passed: 38,
      failed: 2,
      skipped: 0,
      build123d: "0.13.0",
    });
    expect(after[blenderFile].commit).toBe("c1");
  });

  it("drops entries of files that no longer need a real engine", () => {
    const after = recorded(
      { "packages/gone/system-boundary/old.test.ts": { commit: "c0" } },
      new Map(),
      files,
      { commit: "c1", versions, at },
    );
    expect(after).toEqual({});
  });

  it("lists the files in order, so the file changes only where a run changed it", () => {
    const record = passingRecord("c1");
    expect(Object.keys(record)).toEqual([...files.keys()].sort());
  });
});

describe("the files a real-engine run loads", () => {
  const repo = new TemporaryFolders();
  afterEach(() => repo.removeAll());

  /** Writes a small workspace: each path from its root, with its text. */
  async function workspace(contents) {
    const root = await repo.make("zhiyin-reach-");
    for (const [path, text] of Object.entries(contents)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    return root;
  }

  const manifest = (name, exports) =>
    JSON.stringify({ name, type: "module", exports });

  it("are its test files and what they import, through relative paths and the workspace's packages, with the runner's configuration", async () => {
    const root = await workspace({
      "vitest.config.ts": 'import { a } from "./scripts/config-part.mjs";',
      "scripts/config-part.mjs": "export const a = 1;",
      "scripts/test-tools.mjs": "export default () => {};",
      "packages/feature/studio/package.json": manifest("@zhiyin/studio", {
        ".": "./src/index.ts",
      }),
      "packages/feature/studio/system-boundary/real.test.ts": [
        'import { run } from "../src/index.js";',
        'import { box } from "@zhiyin/shapes";',
        'import { fake } from "@zhiyin/shapes/testing";',
        'import { readFile } from "node:fs/promises";',
        'import { expect } from "vitest";',
      ].join("\n"),
      "packages/feature/studio/src/index.ts":
        'export { run } from "./run.js";\nconst later = () => import("./later.js");',
      "packages/feature/studio/src/run.ts": "export const run = 1;",
      "packages/feature/studio/src/later.ts": "export const later = 1;",
      "packages/pure/shapes/package.json": manifest("@zhiyin/shapes", {
        ".": "./src/index.ts",
        "./testing": "./src/testing.ts",
      }),
      "packages/pure/shapes/src/index.ts": "export const box = 1;",
      "packages/pure/shapes/src/testing.ts": "export const fake = 1;",
      "packages/feature/viewer/package.json": manifest("@zhiyin/viewer", {
        ".": "./src/index.ts",
      }),
      "packages/feature/viewer/src/index.ts": "export const view = 1;",
    });

    expect(
      [
        ...reachedFiles(root, [
          "packages/feature/studio/system-boundary/real.test.ts",
        ]),
      ].sort(),
    ).toEqual([
      "packages/feature/studio/src/index.ts",
      "packages/feature/studio/src/later.ts",
      "packages/feature/studio/src/run.ts",
      "packages/feature/studio/system-boundary/real.test.ts",
      "packages/pure/shapes/src/index.ts",
      "packages/pure/shapes/src/testing.ts",
      "scripts/config-part.mjs",
      "scripts/test-tools.mjs",
      "vitest.config.ts",
    ]);
  });
});

describe("the changes that can alter a real-engine run", () => {
  const reached = new Set([
    "packages/feature/blender-studio/system-boundary/real-blender.test.ts",
    "packages/feature/blender-studio/src/index.ts",
    "apps/desktop/system-boundary/scene-drawing.test.ts",
    "scripts/test-tools.mjs",
    "vitest.config.ts",
  ]);

  it("are those to any file of a package the run loads from, its scripts and pins among them, and to a file it loads outside the packages", () => {
    expect(
      changesThatCount(
        [
          "packages/feature/blender-studio/src/session/x.py",
          "apps/desktop/src/renderer/App.tsx",
          "scripts/test-tools.mjs",
        ],
        reached,
      ),
    ).toEqual([
      "packages/feature/blender-studio/src/session/x.py",
      "apps/desktop/src/renderer/App.tsx",
      "scripts/test-tools.mjs",
    ]);
  });

  it("are those to the workspace's build files: its manifest, lock, packages and compiler settings", () => {
    const build = [
      ".gitattributes",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "tsconfig.base.json",
    ];
    expect(changesThatCount(build, reached)).toEqual(build);
  });

  it("are not those to a package the run does not load from, to docs, workflows or other scripts, or to the record", () => {
    expect(
      changesThatCount(
        [
          "packages/feature/document-viewer/src/document-ordering.ts",
          "docs/tooling.md",
          ".github/workflows/ci.yml",
          "scripts/gate.ps1",
          "scripts/real-engine-record.mjs",
          "scripts/real-engine-record.json",
          "CHANGELOG.md",
        ],
        reached,
      ),
    ).toEqual([]);
  });
});

describe("the fingerprint of what a run loads", () => {
  const reached = new Set([
    "packages/feature/cad-studio/src/index.ts",
    "apps/desktop/system-boundary/scene-drawing.test.ts",
  ]);
  const tree = [
    { path: "packages/feature/cad-studio/src/index.ts", blob: "a1" },
    { path: "packages/feature/cad-studio/src/harness/x.py", blob: "b1" },
    { path: "packages/feature/tools/src/index.ts", blob: "c1" },
    { path: "pnpm-lock.yaml", blob: "d1" },
    { path: "docs/tooling.md", blob: "e1" },
  ];
  const changed = (path, blob) =>
    tree.map((file) => (file.path === path ? { path, blob } : file));

  it("is the same for the same files, whatever order the tree lists them in", () => {
    expect(loadsFingerprint([...tree].reverse(), reached)).toBe(
      loadsFingerprint(tree, reached),
    );
  });

  it("changes when a file of a package the run loads from, or a build file, changes", () => {
    const before = loadsFingerprint(tree, reached);
    expect(
      loadsFingerprint(
        changed("packages/feature/cad-studio/src/harness/x.py", "b2"),
        reached,
      ),
    ).not.toBe(before);
    expect(loadsFingerprint(changed("pnpm-lock.yaml", "d2"), reached)).not.toBe(
      before,
    );
  });

  it("stays the same when only a package the run does not load from, or the docs, change", () => {
    const before = loadsFingerprint(tree, reached);
    expect(
      loadsFingerprint(
        changed("packages/feature/tools/src/index.ts", "c2"),
        reached,
      ),
    ).toBe(before);
    expect(loadsFingerprint(changed("docs/tooling.md", "e2"), reached)).toBe(
      before,
    );
  });
});

describe("the release check", () => {
  const unchanged = () => [];
  const reached = new Set([
    "packages/feature/blender-studio/src/index.ts",
    "packages/feature/cad-studio/src/index.ts",
  ]);

  it("accepts every file run whole and passing on this commit, with the engines the app pins", () => {
    expect(
      recordProblems(passingRecord("head"), files, {
        changedSince: unchanged,
        pins,
        reached,
      }),
    ).toEqual([]);
  });

  it("accepts a run on the commit before, when the record is all that changed since", () => {
    expect(
      recordProblems(passingRecord("before"), files, {
        changedSince: () => ["scripts/real-engine-record.json"],
        pins,
        reached,
      }),
    ).toEqual([]);
  });

  it("accepts a run on an earlier commit when nothing the run loads has changed since", () => {
    expect(
      recordProblems(passingRecord("before"), files, {
        changedSince: () => [
          "scripts/real-engine-record.json",
          "packages/feature/document-viewer/src/document-ordering.ts",
          "docs/tooling.md",
        ],
        pins,
        reached,
      }),
    ).toEqual([]);
  });

  it("refuses a run on a commit the code it loads has changed since, naming the change", () => {
    const problems = recordProblems(passingRecord("before"), files, {
      changedSince: () => [
        "scripts/real-engine-record.json",
        "docs/tooling.md",
        "packages/feature/blender-studio/src/session/x.py",
      ],
      pins,
      reached,
    });
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain(
      "1 file it loads from changed since: packages/feature/blender-studio/src/session/x.py",
    );
  });

  it("refuses a run on a commit this repository's history does not hold", () => {
    const problems = recordProblems(passingRecord("lost"), files, {
      changedSince: () => null,
      pins,
      reached,
    });
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain("history");
  });

  it("accepts a run on a commit this history does not hold, as after a rebased merge, when the files it loads are the same", () => {
    expect(
      recordProblems(passingRecord("rebased-away", "same files"), files, {
        changedSince: () => null,
        loads: "same files",
        pins,
        reached,
      }),
    ).toEqual([]);
  });

  it("refuses a run on a commit this history does not hold when the files it loads are no longer the same", () => {
    const problems = recordProblems(
      passingRecord("rebased-away", "files then"),
      files,
      { changedSince: () => null, loads: "files now", pins, reached },
    );
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain("history");
  });

  it("refuses a run on a commit the history holds when the code it loads changed since, whatever the files were named then", () => {
    const problems = recordProblems(passingRecord("before", "files"), files, {
      changedSince: () => ["packages/feature/cad-studio/src/x.py"],
      loads: "other files",
      pins,
      reached,
    });
    expect(problems[0]).toContain(
      "1 file it loads from changed since: packages/feature/cad-studio/src/x.py",
    );
  });

  it("refuses a file with no run recorded", () => {
    const record = passingRecord("head");
    delete record[cadFile];
    expect(
      recordProblems(record, files, { changedSince: unchanged, pins, reached }),
    ).toEqual([expect.stringContaining(`${cadFile}: no run`)]);
  });

  it("refuses a run with a failure or a skip", () => {
    const record = passingRecord("head");
    record[blenderFile] = { ...record[blenderFile], failed: 1 };
    record[cadFile] = { ...record[cadFile], skipped: 4 };
    expect(
      recordProblems(record, files, { changedSince: unchanged, pins, reached }),
    ).toEqual([
      expect.stringContaining(`${blenderFile}: 1 failed`),
      expect.stringContaining(`${cadFile}: 4 skipped`),
    ]);
  });

  it("refuses a run with a Blender or a build123d other than the app's", () => {
    const record = passingRecord("head");
    record[bothFile] = {
      ...record[bothFile],
      blender: "5.1.0",
      build123d: null,
    };
    expect(
      recordProblems(record, files, { changedSince: unchanged, pins, reached }),
    ).toEqual([
      expect.stringContaining("Blender 5.1.0, where the app installs 5.2.2"),
      expect.stringContaining(
        "build123d unknown, where the CAD environment pins 0.13.0",
      ),
    ]);
  });

  it("refuses a missing record", () => {
    expect(
      recordProblems(undefined, files, {
        changedSince: unchanged,
        pins,
        reached,
      }),
    ).toEqual([expect.stringContaining("no record")]);
  });
});
