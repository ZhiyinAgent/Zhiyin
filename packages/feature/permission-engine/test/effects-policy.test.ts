import { describe, expect, it } from "vitest";
import type { ActionEffects } from "@zhiyin/contract";
import {
  GuardedPermissionEngine,
  type Action,
  type ConversationFacts,
} from "../src/index.js";

/** An action that does nothing at all, to which each case adds what it does. */
const nothing: ActionEffects = {
  reads: "none",
  changes: "none",
  sends: "none",
  actsAsPerson: "none",
  runs: "none",
  lasting: false,
  brings: "none",
};

/** A conversation with no outside content and nothing private. */
const clean: ConversationFacts = {
  outsideContent: false,
  privateWithinReach: false,
};

/** Outside content and something private both present. */
const exposed: ConversationFacts = {
  outsideContent: true,
  privateWithinReach: true,
};

function acting(
  effects: Partial<ActionEffects>,
  conversation: ConversationFacts = clean,
  owner: Action["owner"] = "built-in",
  shipped = false,
): Action {
  return {
    kind: "tool",
    owner,
    name: "any_tool",
    arguments: {},
    action: "Do something",
    target: "somewhere",
    command: "any_tool({})",
    effects: { ...nothing, ...effects },
    conversation,
    ...(shipped ? { builtInConnection: true as const } : {}),
  };
}

const decide = (action: Action) => new GuardedPermissionEngine().decide(action);

describe("what runs without asking", () => {
  it.each([
    ["reading the workspace", { reads: "workspace" }],
    ["reading Zhiyin's own records", { reads: "app" }],
    ["reading the person's account on a service", { reads: "account" }],
    ["changing Zhiyin's own records", { changes: "app" }],
    ["bringing outside content in", { brings: "outside" }],
    ["running sealed-off code", { runs: "sealed" }],
    ["sending to a service the person connected", { sends: "service" }],
  ] as const)(
    "%s, even once outside content and something private meet",
    async (_case, effects) => {
      expect(await decide(acting(effects, exposed))).toMatchObject({
        outcome: "allow",
      });
    },
  );

  it("runs changes in the workspace that Zhiyin can put back, in a folder of the person's own files too", async () => {
    expect(await decide(acting({ changes: "workspace" }, clean))).toMatchObject(
      { outcome: "allow" },
    );
    expect(
      await decide(acting({ changes: "workspace" }, exposed)),
    ).toMatchObject({ outcome: "allow" });
  });

  it("sends what the model wrote to a destination it chose when no outside content is present, or nothing private is within reach", async () => {
    for (const conversation of [
      clean,
      { ...exposed, outsideContent: false },
      { ...exposed, privateWithinReach: false },
    ])
      expect(
        await decide(acting({ sends: "chosen" }, conversation)),
      ).toMatchObject({ outcome: "allow" });
  });
});

describe("what asks every time, with no grant to cover it", () => {
  it.each([
    ["code with the person's full access", { runs: "full-access" }],
    ["a change Zhiyin cannot put back", { changes: "workspace-for-good" }],
    ["acting as the person for good", { actsAsPerson: "for-good" }],
    ["leaving something that runs later", { lasting: true }],
  ] as const)("%s, even in a clean conversation", async (_case, effects) => {
    expect(await decide(acting(effects, clean))).toMatchObject({
      outcome: "ask",
      covers: "never",
    });
  });

  it("a send of what the model wrote to a destination it chose, once outside content and something private meet", async () => {
    expect(
      await decide(acting({ sends: "chosen", reads: "workspace" }, exposed)),
    ).toMatchObject({ outcome: "ask", covers: "never" });
  });
});

describe("going to an address the conversation already holds", () => {
  it("runs once outside content and something private meet, since the address carries nothing the model wrote", async () => {
    expect(
      await decide({
        ...acting(
          {
            sends: "chosen",
            destination: "https://example.com/a",
            carries: "address",
          },
          exposed,
        ),
        destinationSeen: true,
      }),
    ).toMatchObject({ outcome: "allow" });
  });

  it("does not excuse what else a send carries: text typed or code run on a page the conversation knows still asks", async () => {
    expect(
      await decide({
        ...acting(
          { sends: "chosen", destination: "https://example.com" },
          exposed,
        ),
        destinationSeen: true,
      }),
    ).toMatchObject({ outcome: "ask", covers: "never" });
  });
});

describe("acting on a page with nothing the model wrote", () => {
  it("runs once outside content and something private meet, since the site receives no words of the model's", async () => {
    expect(
      await decide(
        acting(
          {
            sends: "chosen",
            destination: "https://example.com",
            carries: "nothing",
          },
          exposed,
        ),
      ),
    ).toMatchObject({ outcome: "allow" });
  });
});

describe("what asks once, and the grant that covers it", () => {
  it("acting as the person in a way that can be taken back, through a connection, is covered for its destination", async () => {
    expect(
      await decide(
        acting(
          { actsAsPerson: "once", destination: "owner/repository" },
          clean,
          "mcp",
          true,
        ),
      ),
    ).toMatchObject({ outcome: "ask", covers: "destination" });
  });

  it("acting as the person not through a connection asks every time, since a grant for a destination spans a connection's tools", async () => {
    expect(
      await decide(
        acting({ actsAsPerson: "once", destination: "owner/repository" }),
      ),
    ).toMatchObject({ outcome: "ask", covers: "never", why: "acts-as-you" });
  });

  it("acting as the person where the call does not say asks every time, as acting as them, not as acting for good", async () => {
    expect(await decide(acting({ actsAsPerson: "once" }))).toMatchObject({
      outcome: "ask",
      covers: "never",
      why: "acts-as-you",
    });
  });

  it("a change elsewhere on this computer is covered by its file or folder", async () => {
    expect(await decide(acting({ changes: "elsewhere" }))).toMatchObject({
      outcome: "ask",
      covers: "file-or-folder",
    });
  });

  it("a read elsewhere on this computer asks every time: no grant covers reading there", async () => {
    expect(await decide(acting({ reads: "elsewhere" }))).toMatchObject({
      outcome: "ask",
      covers: "never",
      why: "outside-folder",
    });
  });

  it("a change elsewhere declared by a connection whose effects alone Zhiyin's manifest says asks every time: a file grant is bound to paths only Zhiyin's own code declares", async () => {
    expect(
      await decide({
        ...acting({ changes: "elsewhere" }, clean, "mcp"),
        effectsDeclaredByZhiyin: true,
      }),
    ).toMatchObject({ outcome: "ask", covers: "never", why: "outside-folder" });
  });

  it("the strictest part of an action decides it", async () => {
    expect(
      await decide(acting({ changes: "elsewhere", runs: "full-access" })),
    ).toMatchObject({ outcome: "ask", covers: "never" });
    expect(
      await decide(
        acting({ changes: "workspace", actsAsPerson: "once" }, exposed),
      ),
    ).toMatchObject({ outcome: "ask", covers: "never" });
  });
});

describe("the person's lasting choices", () => {
  it("runs a tool of a connection Zhiyin does not ship once the person said it only reads", async () => {
    expect(
      await decide({
        ...acting({ sends: "chosen" }, exposed, "mcp"),
        personSays: "only-reads",
      }),
    ).toMatchObject({ outcome: "allow" });
  });

  it("reads that choice for a connected tool that declares nothing, as such tools do", async () => {
    const declaresNothing: Action = { ...acting({}, exposed, "mcp") };
    delete (declaresNothing as { effects?: ActionEffects }).effects;
    expect(
      await decide({ ...declaresNothing, personSays: "only-reads" }),
    ).toMatchObject({ outcome: "allow" });
    expect(
      await decide({ ...declaresNothing, personSays: "ask-each-time" }),
    ).toMatchObject({ outcome: "ask", covers: "never" });
  });

  it("asks every time for such a tool the person wants asked about every time", async () => {
    expect(
      await decide({
        ...acting({}, clean, "mcp"),
        personSays: "ask-each-time",
      }),
    ).toMatchObject({ outcome: "ask", covers: "never" });
  });

  it("asks every time for code with full access, even when what it changes can be put back", async () => {
    expect(
      await decide(acting({ runs: "full-access", changes: "workspace" })),
    ).toMatchObject({ outcome: "ask", covers: "never" });
  });
});

describe("whose word counts", () => {
  it("a connection Zhiyin ships is trusted for what it declares", async () => {
    expect(
      await decide(acting({ reads: "workspace" }, clean, "mcp", true)),
    ).toMatchObject({ outcome: "allow" });
  });

  it("a remote connection whose effects Zhiyin's own manifest declares is trusted for them", async () => {
    expect(
      await decide({
        ...acting({ sends: "service", brings: "outside" }, clean, "mcp"),
        effectsDeclaredByZhiyin: true,
      }),
    ).toMatchObject({ outcome: "allow" });
  });

  it("a connection Zhiyin does not ship asks whatever it declares, covered tool by tool", async () => {
    expect(
      await decide(acting({ reads: "workspace" }, clean, "mcp")),
    ).toMatchObject({ outcome: "ask", covers: "tool" });
  });

  it("a plugin or skill is trusted only to read what it holds", async () => {
    expect(
      await decide(acting({ reads: "app" }, clean, "plugin")),
    ).toMatchObject({ outcome: "allow" });
    expect(
      await decide(acting({ sends: "chosen" }, clean, "skill")),
    ).toMatchObject({ outcome: "ask", covers: "never" });
  });

  it("an action that does not say what it does asks every time, as the worst it could do, whoever owns it", async () => {
    for (const [owner, shipped] of [
      ["built-in", false],
      ["mcp", true],
      ["skill", false],
      ["plugin", false],
    ] as const) {
      const declaresNothing: Action = { ...acting({}, clean, owner, shipped) };
      delete (declaresNothing as { effects?: ActionEffects }).effects;
      expect(await decide(declaresNothing)).toEqual({
        outcome: "ask",
        covers: "never",
        reason:
          "This does not say what it does, so it is decided as the worst it could do, and requires an explicit decision each time.",
      });
    }
  });

  it("a sealed build of code the model wrote, changing only the workspace, runs: what it changes is backed up", async () => {
    expect(
      await decide({
        ...acting(
          { reads: "workspace", changes: "workspace", runs: "sealed" },
          exposed,
          "mcp",
          true,
        ),
        name: "cad_build",
        action: "Build a CAD part",
        target: "plate.py",
      }),
    ).toEqual({
      outcome: "allow",
      reason:
        "Nothing this does needs a decision: it is contained, or Zhiyin can put it back.",
    });
  });

  it("without what the conversation holds, it is decided as if outside content and something private had met", async () => {
    const unknown: Action = { ...acting({ sends: "chosen" }) };
    delete (unknown as { conversation?: ConversationFacts }).conversation;
    expect(await decide(unknown)).toMatchObject({
      outcome: "ask",
      covers: "never",
    });
  });

  it("names the part of the policy behind each question, for the card to say why", async () => {
    const cases: [Action, string][] = [
      [acting({ lasting: true }), "runs-later"],
      [acting({ runs: "full-access" }), "full-access"],
      [acting({ changes: "workspace-for-good" }), "cannot-undo"],
      [acting({ actsAsPerson: "for-good" }), "acts-for-good"],
      [acting({ sends: "chosen" }, exposed), "outside-and-private"],
      [acting({ actsAsPerson: "once", destination: "o/r" }), "acts-as-you"],
      [acting({ changes: "elsewhere" }), "outside-folder"],
      [
        acting({
          changes: "elsewhere",
          actsAsPerson: "once",
          destination: "o/r",
        }),
        "several",
      ],
      [acting({}, clean, "mcp"), "connected-tool"],
      [
        { ...acting({}, clean, "mcp"), personSays: "ask-each-time" },
        "you-asked-each-time",
      ],
      [acting({ sends: "chosen" }, clean, "plugin"), "plugin-beyond-read"],
    ];
    for (const [action, why] of cases)
      expect(await decide(action)).toMatchObject({ outcome: "ask", why });
  });

  it("names each part of the policy behind a question raised by several", async () => {
    expect(
      await decide(
        acting({
          changes: "elsewhere",
          actsAsPerson: "once",
          destination: "o/r",
        }),
      ),
    ).toMatchObject({
      why: "several",
      parts: ["acts-as-you", "outside-folder"],
    });
  });

  it("gives a plain reason with every decision", async () => {
    const decision = await decide(acting({ runs: "full-access" }));
    expect(decision.reason).toMatch(/full access/);
  });
});
