/** What an action is, and why the person is asked about it, as drawn from what its owner declared. */

import { describe, expect, it } from "vitest";
import type { ActionEffects } from "@zhiyin/contract";
import { actionKind, askedReason } from "./actionFacts.js";

const nothing: ActionEffects = {
  reads: "none",
  changes: "none",
  sends: "none",
  actsAsPerson: "none",
  runs: "none",
  lasting: false,
  brings: "none",
};
const does = (more: Partial<ActionEffects>): ActionEffects => ({
  ...nothing,
  ...more,
});

describe("the kind of an action, drawn as its icon", () => {
  it("is told by what the action declared, never by its words", () => {
    expect(actionKind({ effects: does({ runs: "full-access" }) })).toBe("code");
    expect(actionKind({ effects: does({ runs: "sealed" }) })).toBe("code");
    expect(
      actionKind({ effects: does({ actsAsPerson: "once", sends: "service" }) }),
    ).toBe("user");
    expect(actionKind({ effects: does({ reads: "account" }) })).toBe("user");
    expect(actionKind({ effects: does({ changes: "workspace" }) })).toBe(
      "file",
    );
    expect(actionKind({ effects: does({ changes: "app" }) })).toBe("settings");
    expect(actionKind({ effects: does({ sends: "chosen" }) })).toBe("globe");
    expect(actionKind({ effects: does({ brings: "outside" }) })).toBe("globe");
    expect(actionKind({ effects: does({ sends: "service" }) })).toBe("plug");
    expect(actionKind({ effects: does({ reads: "workspace" }) })).toBe("file");
    expect(actionKind({ effects: nothing })).toBe("spark");
  });

  it("shows a deletion as one, whatever else it does", () => {
    expect(
      actionKind({
        effects: does({ changes: "workspace" }),
        changes: [{ path: "old.md", change: "recycled" }],
      }),
    ).toBe("trash");
  });

  it("shows a move as a change to files, not as a deletion", () => {
    expect(
      actionKind({
        effects: does({ reads: "workspace", changes: "workspace" }),
        changes: [
          { path: "notes.md", change: "moved", to: "kept/notes.md" },
          { path: "kept/notes.md", change: "created", from: "notes.md" },
        ],
      }),
    ).toBe("file");
  });

  it("falls back to the files it changes, or to the connection it goes to", () => {
    expect(actionKind({ changes: [{ path: "a.md", change: "updated" }] })).toBe(
      "file",
    );
    expect(actionKind({ connector: true })).toBe("plug");
    expect(actionKind({})).toBe("spark");
  });
});

describe("why the person is asked", () => {
  const codes = [
    "runs-later",
    "full-access",
    "cannot-undo",
    "acts-for-good",
    "outside-and-private",
    "acts-as-you",
    "outside-folder",
    "connected-tool",
    "you-asked-each-time",
    "plugin-beyond-read",
  ] as const;

  it("gives every part of the policy that asks a short label and its own explanation", () => {
    const said = codes.map((code) => askedReason({ code }));
    for (const each of said) {
      expect(each?.labels.length).toBeGreaterThan(0);
      for (const label of each?.labels ?? [])
        expect(label.length).toBeLessThanOrEqual(24);
      expect(each?.explanation).toMatch(/\.$/);
    }
    expect(new Set(said.map((each) => each?.labels.join()))).toHaveProperty(
      "size",
      codes.length,
    );
    expect(new Set(said.map((each) => each?.explanation))).toHaveProperty(
      "size",
      codes.length,
    );
  });

  it("says plainly what each label is about, without alarm", () => {
    for (const code of codes) {
      const said = askedReason({ code });
      expect(said?.labels.join(" ")).not.toMatch(/!|danger|warning/i);
      expect(said?.short).not.toMatch(/!/);
      expect(said?.explanation).not.toMatch(/!/);
    }
  });

  it("gives every part of the policy that asks one clause that says what its label means, to read on the card", () => {
    const shorts = codes.map((code) => askedReason({ code })?.short ?? "");
    for (const short of shorts) {
      expect(short).toMatch(/\.$/);
      expect(short.length).toBeLessThanOrEqual(90);
    }
    expect(new Set(shorts)).toHaveProperty("size", codes.length);
  });

  it("labels a shell command as full access, and says what of it can be undone", () => {
    const said = askedReason({ code: "full-access" });
    expect(said?.labels).toEqual(["Full access"]);
    expect(said?.short).toBe(
      "it can change anything your Windows account can; only this folder can be undone.",
    );
    expect(said?.explanation).toContain("your Windows account");
    expect(said?.explanation).toContain("can be undone");
  });

  it("labels what can't be put back as having no undo", () => {
    expect(askedReason({ code: "cannot-undo" })?.labels).toEqual(["No undo"]);
    expect(askedReason({ code: "acts-for-good" })?.labels).toEqual([
      "Uses your account",
      "No undo",
    ]);
  });

  it("names the site a send goes to by its host, and where the outside content came from", () => {
    const said = askedReason(
      { code: "outside-and-private", outsideFrom: "news.example" },
      does({
        sends: "chosen",
        destination: "https://forms.example/contact?id=1",
      }),
    );
    expect(said?.labels).toEqual(["Sends to forms.example"]);
    expect(said?.explanation).toContain("news.example");
    expect(said?.explanation).toContain("forms.example");
    expect(
      askedReason({ code: "outside-and-private" })?.explanation,
    ).not.toContain("from ");
  });

  it("names the place an action acts as the person, and says when it cannot tell where", () => {
    expect(
      askedReason(
        { code: "acts-as-you" },
        does({ actsAsPerson: "once", destination: "octo/hello" }),
      )?.explanation,
    ).toContain("octo/hello");
    const unnamed = askedReason(
      { code: "acts-as-you" },
      does({ actsAsPerson: "once", sends: "service" }),
    )?.explanation;
    expect(unnamed).toContain("can't tell where");
    expect(unnamed).toContain("each time");
  });

  it("gives each reason behind a question asked for several its label, and explains each", () => {
    const said = askedReason({
      code: "several",
      parts: ["acts-as-you", "outside-folder"],
    });
    expect(said?.labels).toEqual(["Uses your account", "Outside this folder"]);
    expect(said?.explanation).toContain("acts as you");
    expect(said?.explanation).toContain("outside the folder");
  });

  it("finds the reasons behind several from what the action declared, when the policy did not list them", () => {
    expect(
      askedReason(
        { code: "several" },
        does({ actsAsPerson: "once", reads: "elsewhere" }),
      )?.labels,
    ).toEqual(["Uses your account", "Outside this folder"]);
  });

  it("says nothing when the policy gave no reason", () => {
    expect(askedReason(undefined)).toBeUndefined();
  });
});
