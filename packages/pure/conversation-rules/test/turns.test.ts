import { describe, expect, it } from "vitest";
import { actionsOfTurn, turnUnderWay } from "../src/index.js";

describe("turnUnderWay", () => {
  it.each(["working", "approval", "input"] as const)(
    "counts a turn that is %s as under way",
    (kind) => {
      expect(turnUnderWay(kind)).toBe(true);
    },
  );

  it.each(["draft", "completed", "failed", "interrupted"] as const)(
    "counts a conversation that is %s as having no turn under way",
    (kind) => {
      expect(turnUnderWay(kind)).toBe(false);
    },
  );
});

describe("actionsOfTurn", () => {
  const action = (id: string, sequence: number) => ({
    id,
    sequence,
    action: "Read a file",
    target: `${id}.md`,
    status: "completed" as const,
  });
  const conversation = {
    messages: [
      { sequence: 0, id: "m1", role: "user" as const, text: "Read the notes." },
      {
        sequence: 3,
        id: "q",
        role: "user" as const,
        text: "Yes",
        interactionId: "i1",
      },
      { sequence: 5, id: "m2", role: "user" as const, text: "Now the plan." },
      { sequence: 6, id: "answer", role: "assistant" as const, text: "Done." },
    ],
    actions: [action("a1", 1), action("a2", 4), action("a3", 7)],
  };

  it("holds every action until the person's next message, an answer to a question included", () => {
    expect(actionsOfTurn(conversation, "m1")?.map((item) => item.id)).toEqual([
      "a1",
      "a2",
    ]);
    expect(actionsOfTurn(conversation, "m2")?.map((item) => item.id)).toEqual([
      "a3",
    ]);
  });

  it("is no turn for an answer to a question, or a message that is not the person's", () => {
    expect(actionsOfTurn(conversation, "q")).toBeUndefined();
    expect(actionsOfTurn(conversation, "answer")).toBeUndefined();
  });
});
