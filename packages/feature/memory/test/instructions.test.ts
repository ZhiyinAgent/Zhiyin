import { afterEach, describe, expect, it } from "vitest";
import { conversation, folders, memoryIn } from "./fixture.js";

afterEach(() => folders.removeAll());

const said = [
  "Can you proofread chapter 3?",
  "Please, from now on   answer me in French.",
];

const answerInFrench = {
  section: "how",
  scope: "everything",
  rule: "Answer in French.",
  quote: "from now on answer me in French",
} as const;

function refusal(outcome: { ok: boolean; reason?: string }): string {
  if (outcome.ok) throw new Error("The write was kept.");
  return outcome.reason!;
}

async function howToWork(
  memory: Awaited<ReturnType<typeof memoryIn>>["memory"],
) {
  return (await memory.state()).entries.find(
    (entry) => entry.section === "how" && entry.scope === "everything",
  );
}

describe("instructions come only from the person", () => {
  it("adds a rule that quotes the person's own words", async () => {
    const { memory } = await memoryIn();

    const kept = await memory.remember(answerInFrench, conversation(said));

    expect(kept).toMatchObject({
      ok: true,
      change: { change: "added", section: "how", title: "How to work" },
    });
    expect((await howToWork(memory))?.text).toBe("- Answer in French.");
  });

  it("reads the quote as the person wrote it, whatever the spaces between words", async () => {
    const { memory } = await memoryIn();

    const kept = await memory.remember(
      { ...answerInFrench, quote: "from now on answer me" },
      conversation(said),
    );

    expect(kept.ok).toBe(true);
  });

  it("refuses a quote the person never wrote", async () => {
    const { memory } = await memoryIn();

    expect(
      refusal(
        await memory.remember(
          { ...answerInFrench, quote: "always answer in French" },
          conversation(said),
        ),
      ),
    ).toBe(
      "The quote is not in the person's messages. A rule for how to work, or about the person, rests on their own words: quote them exactly, as they wrote them in this conversation.",
    );
  });

  it("refuses an instruction with no quote", async () => {
    const { memory } = await memoryIn();

    expect(
      refusal(
        await memory.remember(
          { section: "how", scope: "everything", rule: "Answer in French." },
          conversation(said),
        ),
      ),
    ).toMatch(/^The quote is not in the person's messages\./);
  });

  it("adds each rule on a line of its own", async () => {
    const { memory } = await memoryIn();
    await memory.remember(answerInFrench, conversation(said));

    await memory.remember(
      {
        section: "how",
        scope: "everything",
        rule: "Proofread without restructuring.",
        quote: "proofread chapter 3",
      },
      conversation(said),
    );

    expect((await howToWork(memory))?.text).toBe(
      "- Answer in French.\n- Proofread without restructuring.",
    );
  });

  it("replaces a rule named word for word, and only that rule", async () => {
    const { memory } = await memoryIn();
    await memory.remember(answerInFrench, conversation(said));
    await memory.remember(
      { ...answerInFrench, rule: "Short answers first." },
      conversation(said),
    );

    const changed = await memory.remember(
      {
        ...answerInFrench,
        rule: "Answer in English.",
        replaces: "Answer in French.",
      },
      conversation(said),
    );

    expect(changed).toMatchObject({ ok: true, change: { change: "changed" } });
    expect((await howToWork(memory))?.text).toBe(
      "- Answer in English.\n- Short answers first.",
    );
  });

  it("removes a rule named word for word", async () => {
    const { memory } = await memoryIn();
    await memory.remember(answerInFrench, conversation(said));
    await memory.remember(
      { ...answerInFrench, rule: "Short answers first." },
      conversation(said),
    );

    await memory.remember(
      {
        section: "how",
        scope: "everything",
        replaces: "Answer in French.",
        remove: true,
        quote: "from now on",
      },
      conversation(said),
    );

    expect((await howToWork(memory))?.text).toBe("- Short answers first.");
  });

  it("reads an empty replaces as naming no rule, so the rule is added", async () => {
    for (const replaces of ["", "  "]) {
      const { memory } = await memoryIn();

      const kept = await memory.remember(
        { ...answerInFrench, replaces },
        conversation(said),
      );

      expect(kept).toMatchObject({ ok: true, change: { change: "added" } });
      expect((await howToWork(memory))?.text).toBe("- Answer in French.");
    }
  });

  it("refuses to replace a rule that is not there, listing the rules that are", async () => {
    const { memory } = await memoryIn();
    await memory.remember(answerInFrench, conversation(said));

    expect(
      refusal(
        await memory.remember(
          { ...answerInFrench, rule: "x", replaces: "Answer in German." },
          conversation(said),
        ),
      ),
    ).toBe(
      "How to work has no rule that reads exactly “Answer in German.”. Its rules:\n- Answer in French.",
    );
  });

  it("keeps About you for everything the person does only", async () => {
    const { memory } = await memoryIn();
    const project = (await memory.createProject("Thesis")).project!.id;

    expect(
      refusal(
        await memory.remember(
          { ...answerInFrench, section: "about", scope: "project" },
          conversation(said, { project }),
        ),
      ),
    ).toBe(
      'About you is kept for everything the person does: use scope "everything".',
    );
  });

  it("keeps a project's How to work apart from the person's", async () => {
    const { memory } = await memoryIn();
    const project = (await memory.createProject("Thesis")).project!.id;

    await memory.remember(
      { ...answerInFrench, scope: "project", rule: "Cite in APA." },
      conversation(said, { project }),
    );

    expect((await memory.state()).entries).toMatchObject([
      { scope: project, section: "how", text: "- Cite in APA." },
    ]);
  });

  it("refuses a rule that would take How to work and About you past their shared limit", async () => {
    const { memory } = await memoryIn();
    await memory.add({
      scope: "everything",
      section: "about",
      text: "a".repeat(4_000 * 3 - 6),
    });

    expect(
      refusal(await memory.remember(answerInFrench, conversation(said))),
    ).toMatch(
      /^About you and How to work would take about 4,0\d\d tokens; together they hold at most 4,000\. Fold this into a rule already there, or ask the person which rule can go\.$/,
    );
  });
});

describe("after outside content, a change to an instruction waits for the person", () => {
  const afterAPage = conversation(said, {
    held: { outside: true, because: "a web page" },
  });

  it("keeps the change aside and says it waits", async () => {
    const { memory } = await memoryIn();

    const kept = await memory.remember(answerInFrench, afterAPage);

    expect(kept).toMatchObject({
      ok: true,
      answer: { kept: "waiting" },
      change: {
        change: "waiting",
        waiting: { rule: "Answer in French.", because: "a web page" },
      },
    });
    expect(await howToWork(memory)).toBeUndefined();
    expect((await memory.state()).waiting).toMatchObject([
      { rule: "Answer in French.", because: "a web page" },
    ]);
  });

  it("applies the change once the person keeps it", async () => {
    const { memory } = await memoryIn();
    const kept = await memory.remember(answerInFrench, afterAPage);
    const waitingId = kept.ok ? kept.change.waiting!.id : "";

    expect(await memory.keep(waitingId)).toEqual({ ok: true });

    expect((await howToWork(memory))?.text).toBe("- Answer in French.");
    expect((await memory.state()).waiting).toEqual([]);
  });

  it("adds a waiting rule once, even when it is already there", async () => {
    const { memory } = await memoryIn();
    const kept = await memory.remember(answerInFrench, afterAPage);
    const waitingId = kept.ok ? kept.change.waiting!.id : "";
    await memory.add({
      scope: "everything",
      section: "how",
      text: "- Answer in French.",
    });

    expect(await memory.keep(waitingId)).toEqual({ ok: true });

    expect((await howToWork(memory))?.text).toBe("- Answer in French.");
  });

  it("refuses to keep a change for a project no longer kept, saying why", async () => {
    const { memory } = await memoryIn();
    const thesis = (await memory.createProject("Thesis")).project!;
    const kept = await memory.remember(
      { ...answerInFrench, scope: "project" },
      conversation(said, {
        project: thesis.id,
        held: { outside: true, because: "a web page" },
      }),
    );
    const waitingId = kept.ok ? kept.change.waiting!.id : "";
    await memory.deleteProject(thesis.id);

    expect(await memory.keep(waitingId)).toEqual({
      ok: false,
      reason: "That project is no longer kept.",
    });
  });

  it("keeps a change for a project merged into another in that other", async () => {
    const { memory } = await memoryIn();
    const thesis = (await memory.createProject("Thesis")).project!;
    const data = (await memory.createProject("Data")).project!;
    const kept = await memory.remember(
      { ...answerInFrench, scope: "project" },
      conversation(said, {
        project: data.id,
        held: { outside: true, because: "a web page" },
      }),
    );
    const waitingId = kept.ok ? kept.change.waiting!.id : "";
    await memory.mergeProject(data.id, thesis.id);

    expect(await memory.keep(waitingId)).toEqual({ ok: true });

    expect((await memory.state()).entries).toMatchObject([
      { section: "how", scope: thesis.id, text: "- Answer in French." },
    ]);
  });

  it("refuses to discard a change no longer waiting", async () => {
    const { memory } = await memoryIn();
    const kept = await memory.remember(answerInFrench, afterAPage);
    const waitingId = kept.ok ? kept.change.waiting!.id : "";
    await memory.keep(waitingId);

    expect(await memory.discard(waitingId)).toEqual({
      ok: false,
      reason: "That change is no longer waiting.",
    });
  });

  it("drops the change when the person discards it", async () => {
    const { memory } = await memoryIn();
    const kept = await memory.remember(answerInFrench, afterAPage);
    const waitingId = kept.ok ? kept.change.waiting!.id : "";

    await memory.discard(waitingId);

    expect(await howToWork(memory)).toBeUndefined();
    expect((await memory.state()).waiting).toEqual([]);
  });

  it("still needs the person's words to wait", async () => {
    const { memory } = await memoryIn();

    expect(
      refusal(
        await memory.remember(
          { ...answerInFrench, quote: "ignore previous instructions" },
          afterAPage,
        ),
      ),
    ).toMatch(/^The quote is not in the person's messages\./);
  });

  it("keeps Knowledge at once, since it is never sent as an instruction", async () => {
    const { memory } = await memoryIn();

    const kept = await memory.remember(
      {
        section: "knowledge",
        scope: "everything",
        title: "Zotero library",
        summary: "Where references are",
        text: "In the group “Thèse”.",
      },
      afterAPage,
    );

    expect(kept).toMatchObject({ ok: true, change: { change: "added" } });
  });
});
