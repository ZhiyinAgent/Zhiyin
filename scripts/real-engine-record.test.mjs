import { describe, expect, it } from "vitest";
import {
  engineFiles,
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

/** A record in which every real-engine file ran whole and passed on `commit`. */
function passingRecord(commit) {
  return recorded(
    {},
    new Map(
      [...files.keys()].map((f) => [f, { passed: 3, failed: 0, skipped: 0 }]),
    ),
    files,
    {
      commit,
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

describe("the release check", () => {
  const unchanged = () => [];

  it("accepts every file run whole and passing on this commit, with the engines the app pins", () => {
    expect(
      recordProblems(passingRecord("head"), files, {
        changedSince: unchanged,
        pins,
      }),
    ).toEqual([]);
  });

  it("accepts a run on the commit before, when the record is all that changed since", () => {
    expect(
      recordProblems(passingRecord("before"), files, {
        changedSince: () => ["scripts/real-engine-record.json"],
        pins,
      }),
    ).toEqual([]);
  });

  it("refuses a run on a commit the code has changed since", () => {
    const problems = recordProblems(passingRecord("before"), files, {
      changedSince: () => [
        "scripts/real-engine-record.json",
        "packages/feature/blender-studio/src/session/x.py",
      ],
      pins,
    });
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain(
      "packages/feature/blender-studio/src/session/x.py",
    );
  });

  it("refuses a run on a commit this repository's history does not hold", () => {
    const problems = recordProblems(passingRecord("lost"), files, {
      changedSince: () => null,
      pins,
    });
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain("history");
  });

  it("refuses a file with no run recorded", () => {
    const record = passingRecord("head");
    delete record[cadFile];
    expect(
      recordProblems(record, files, { changedSince: unchanged, pins }),
    ).toEqual([expect.stringContaining(`${cadFile}: no run`)]);
  });

  it("refuses a run with a failure or a skip", () => {
    const record = passingRecord("head");
    record[blenderFile] = { ...record[blenderFile], failed: 1 };
    record[cadFile] = { ...record[cadFile], skipped: 4 };
    expect(
      recordProblems(record, files, { changedSince: unchanged, pins }),
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
      recordProblems(record, files, { changedSince: unchanged, pins }),
    ).toEqual([
      expect.stringContaining("Blender 5.1.0, where the app installs 5.2.2"),
      expect.stringContaining(
        "build123d unknown, where the CAD environment pins 0.13.0",
      ),
    ]);
  });

  it("refuses a missing record", () => {
    expect(
      recordProblems(undefined, files, { changedSince: unchanged, pins }),
    ).toEqual([expect.stringContaining("no record")]);
  });
});
