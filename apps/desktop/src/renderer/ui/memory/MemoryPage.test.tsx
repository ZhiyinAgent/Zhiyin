import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  memoryLimits,
  type MemoryEntry,
  type MemoryOutcome,
  type MemoryRequest,
  type MemoryState,
} from "@zhiyin/contract";
import { MemoryPage } from "./MemoryPage.js";

/**
 * A person with what they do in general and one project, the thesis: two
 * knowledge entries in the thesis link to each other, and one in general
 * links into the thesis.
 */
function entry(
  fields: Pick<MemoryEntry, "number" | "scope" | "section" | "title"> &
    Partial<MemoryEntry>,
): MemoryEntry {
  return {
    summary: "",
    text: "",
    written: "2026-10-03T09:00:00.000Z",
    ...fields,
  };
}

const memory: MemoryState = {
  on: true,
  projects: [
    {
      id: "thesis",
      name: "Thesis",
      folders: [],
      created: "2026-09-20T09:00:00.000Z",
    },
  ],
  entries: [
    entry({
      number: 1,
      scope: "everything",
      section: "about",
      title: "About you",
      text: "PhD student in urban climatology.",
    }),
    entry({
      number: 2,
      scope: "everything",
      section: "how",
      title: "How to work",
      text: "Short answers first.",
    }),
    entry({
      number: 3,
      scope: "thesis",
      section: "brief",
      title: "Brief",
      summary: "Chapter 3 drafted",
      text: "Defend in June 2027.",
    }),
    entry({
      number: 12,
      scope: "thesis",
      section: "knowledge",
      title: "Typst over LaTeX",
      summary: "The template needs a custom grid",
      text: "Chosen because of the title page rules (#13).",
      used: "2026-10-30T09:00:00.000Z",
      conversation: { id: "conversation-1", title: "Template setup" },
    }),
    entry({
      number: 13,
      scope: "thesis",
      section: "knowledge",
      title: "University template rules",
      summary: "Margins, fonts, title page",
      text: "Margins 2.5 cm.",
      used: "2026-10-20T09:00:00.000Z",
    }),
    entry({
      number: 31,
      scope: "everything",
      section: "knowledge",
      title: "Zotero library",
      summary: "Where references are kept",
      text: "Export to refs.bib; Typst reads it (#12).",
      used: "2026-10-29T09:00:00.000Z",
    }),
    entry({
      number: 30,
      scope: "everything",
      section: "knowledge",
      title: "Météo-France open data",
      summary: "Hourly station series and licence",
      text: "Station Lyon-Bron is 69029001.",
      used: "2026-10-12T09:00:00.000Z",
    }),
  ],
  waiting: [
    {
      id: "waiting-1",
      scope: "everything",
      section: "how",
      rule: "Cite sources with the date checked.",
      conversation: { id: "conversation-2", title: "Literature review" },
      because: "content from a web page",
      at: "2026-10-30T16:00:00.000Z",
    },
  ],
  limits: memoryLimits,
  broadFolders: [],
};

/** Draws the page; every change is answered with `answer`. */
function page(
  overrides: Partial<Parameters<typeof MemoryPage>[0]> = {},
  answer: MemoryOutcome = { ok: true },
) {
  const onChange = vi.fn<(request: MemoryRequest) => Promise<MemoryOutcome>>(
    async () => answer,
  );
  render(
    <MemoryPage
      memory={memory}
      onChange={onChange}
      onClose={() => {}}
      {...overrides}
    />,
  );
  return onChange;
}

function knowledgeTitles(): string[] {
  const list = screen.getByRole("list", { name: "Knowledge" });
  return within(list)
    .getAllByRole("button")
    .map(
      (row) =>
        row.querySelector("strong")?.textContent ?? row.textContent ?? "",
    );
}

describe("memory page", () => {
  it("shows what is kept for everything the person does: about them, how to work, and knowledge by title and summary, most recently used first", () => {
    page();

    expect(screen.getByText("PhD student in urban climatology.")).toBeVisible();
    expect(screen.getByText("Short answers first.")).toBeVisible();
    expect(knowledgeTitles()).toEqual([
      "Zotero library",
      "Météo-France open data",
    ]);
    expect(screen.getByText("Where references are kept")).toBeVisible();
    expect(screen.getByText("2 of 200")).toBeVisible();
    expect(screen.queryByText("Typst over LaTeX")).toBeNull();
  });

  it("shows a project's brief, and its own knowledge only, once the project is chosen", () => {
    page();

    fireEvent.click(screen.getByRole("button", { name: /Thesis/ }));

    expect(screen.getByText("Defend in June 2027.")).toBeVisible();
    expect(knowledgeTitles()).toEqual([
      "Typst over LaTeX",
      "University template rules",
    ]);
    expect(screen.queryByText("Zotero library")).toBeNull();
    expect(screen.getByRole("button", { name: /Thesis/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("opens an entry with what it links to and what links to it, follows a link, and goes back", () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: /Thesis/ }));
    fireEvent.click(screen.getByRole("button", { name: /Typst over LaTeX/ }));

    const opened = screen.getByRole("article", { name: "Typst over LaTeX" });
    expect(
      within(opened).getByText(/Chosen because of the title page rules/),
    ).toBeVisible();
    expect(within(opened).getByText("Template setup")).toBeVisible();
    const linksTo = within(opened).getByRole("list", { name: "Links to" });
    expect(
      within(linksTo).getByText("University template rules"),
    ).toBeVisible();
    const linkedFrom = within(opened).getByRole("list", {
      name: "Linked from",
    });
    expect(within(linkedFrom).getByText("Zotero library")).toBeVisible();

    fireEvent.click(within(opened).getByRole("button", { name: "#13" }));
    expect(
      screen.getByRole("article", { name: "University template rules" }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("article", { name: "Typst over LaTeX" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Defend in June 2027.")).toBeVisible();
  });

  it("shows a link to an entry no longer kept as plain text", () => {
    page({
      memory: {
        ...memory,
        entries: memory.entries.filter((kept) => kept.number !== 13),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /Thesis/ }));
    fireEvent.click(screen.getByRole("button", { name: /Typst over LaTeX/ }));

    expect(screen.queryByRole("button", { name: "#13" })).toBeNull();
    expect(screen.getByText("#13")).toBeVisible();
  });

  it("searches every scope by the words of an entry, and says when nothing matches", () => {
    page();

    const search = screen.getByRole("searchbox", { name: "Search memory" });
    fireEvent.change(search, { target: { value: "margins" } });
    const results = screen.getByRole("list", { name: "Search results" });
    expect(
      within(results).getByText("University template rules"),
    ).toBeVisible();
    expect(within(results).getByText("Thesis")).toBeVisible();

    fireEvent.change(search, { target: { value: "sourdough" } });
    expect(screen.getByText("Nothing kept matches “sourdough”.")).toBeVisible();

    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("");
    expect(screen.getByText("PhD student in urban climatology.")).toBeVisible();
  });

  it("deletes an entry and brings it back with Undo", async () => {
    const onChange = page({}, { ok: true, writeId: "write-7" });
    fireEvent.click(screen.getByRole("button", { name: /Zotero library/ }));

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onChange).toHaveBeenCalledWith({ kind: "remove", number: 31 });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Deleted #31 Zotero library",
    );

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onChange).toHaveBeenLastCalledWith({
      kind: "undo",
      writeId: "write-7",
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says why memory refused a change", async () => {
    page({}, { ok: false, reason: "Memory could not be written just now." });
    fireEvent.click(screen.getByRole("button", { name: /Zotero library/ }));

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Memory could not be written just now.",
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  // Limits are in estimated tokens: three bytes of UTF-8 to a token.
  it("saves an edited entry, and holds an edit past its section's limit", () => {
    const onChange = page({
      memory: {
        ...memory,
        limits: { ...memory.limits, entry: 10 },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /Zotero library/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const text = screen.getByRole("textbox", { name: "Text" });
    // 47 bytes, 16 tokens.
    fireEvent.change(text, {
      target: { value: "A text far longer than the ten tokens allowed." },
    });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText(/over the limit/)).toBeVisible();

    // 19 bytes, 7 tokens.
    fireEvent.change(text, { target: { value: "Group “Thèse”." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onChange).toHaveBeenCalledWith({
      kind: "edit",
      number: 31,
      edit: {
        title: "Zotero library",
        summary: "Where references are kept",
        text: "Group “Thèse”.",
      },
    });
  });

  it("holds a knowledge entry whose title and summary are too long for the list the model is sent", () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: /Zotero library/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    // "#31 Zotero library: " and this summary make 267 bytes, 89 tokens,
    // past the 80 a line may take.
    const summary = screen.getByRole("textbox", { name: "Summary" });
    fireEvent.change(summary, {
      target: {
        value:
          "Where references are kept, how Better BibTeX exports them to refs.bib after every change, how every document in every project, thesis chapter or conference paper, reads them, and which citation style each of the three journals I submit to requires",
      },
    });
    expect(
      screen.getByText(/too long for the list the model is sent/),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.change(summary, {
      target: { value: "Where references are kept" },
    });
    expect(screen.queryByText(/too long for the list/)).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("counts about the person and how to work for everything against one shared space, as they are sent together", () => {
    // About you, "PhD student in urban climatology.", is 33 bytes, 11 tokens.
    page({
      memory: { ...memory, limits: { ...memory.limits, instructions: 20 } },
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit How to work" }));

    const text = screen.getByRole("textbox", { name: "Text" });
    // 39 bytes, 13 tokens: 24 of 20 with About you.
    fireEvent.change(text, {
      target: { value: "Short answers first, detail when asked." },
    });
    expect(screen.getByText("20% over the limit")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    // 14 bytes, 5 tokens: 16 of 20.
    fireEvent.change(text, { target: { value: "Short answers." } });
    expect(screen.getByText("80% of the space, with About you")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("writes an instruction not written yet, and shows it once kept", async () => {
    const onChange = page();
    fireEvent.click(screen.getByRole("button", { name: /Thesis/ }));
    expect(screen.getByText("Nothing written yet.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Write How to work" }));
    expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Text" }), {
      target: { value: "Cite the university’s rules by section." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onChange).toHaveBeenCalledWith({
      kind: "add",
      draft: {
        scope: "thesis",
        section: "how",
        text: "Cite the university’s rules by section.",
      },
    });
    expect(await screen.findByText("Defend in June 2027.")).toBeVisible();
  });

  it("goes back without writing when a first instruction is cancelled", () => {
    const onChange = page();
    fireEvent.click(screen.getByRole("button", { name: /Thesis/ }));
    fireEvent.click(screen.getByRole("button", { name: "Write How to work" }));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("Defend in June 2027.")).toBeVisible();
  });

  it("asks the person to keep or discard a change to how to work that waits for them", () => {
    const onChange = page();

    const waiting = screen.getByRole("group", { name: "Waiting for you" });
    expect(
      within(waiting).getByText("Cite sources with the date checked."),
    ).toBeVisible();
    expect(within(waiting).getByText(/Literature review/)).toBeVisible();

    fireEvent.click(within(waiting).getByRole("button", { name: "Keep" }));
    expect(onChange).toHaveBeenCalledWith({
      kind: "keep",
      waitingId: "waiting-1",
    });
    fireEvent.click(within(waiting).getByRole("button", { name: "Discard" }));
    expect(onChange).toHaveBeenCalledWith({
      kind: "discard",
      waitingId: "waiting-1",
    });
  });

  it("says in one line how memory fills when nothing is kept yet", () => {
    page({ memory: { ...memory, entries: [], waiting: [] } });

    expect(
      screen.getByText(
        "Nothing kept yet. Zhiyin keeps what will matter later as you work, and shows each one in the conversation.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("list", { name: "Knowledge" })).toBeNull();
  });

  it("says that nothing new is kept or sent while memory is off, and turns it back on", () => {
    const onChange = page({ memory: { ...memory, on: false } });

    expect(
      screen.getByText(
        "Memory is off: nothing new is kept, and nothing kept is sent to the model.",
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("switch", { name: "Remember" }));
    expect(onChange).toHaveBeenCalledWith({ kind: "switch", on: true });
  });

  it("shows a placeholder while memory loads, and why it could not be read", () => {
    const { unmount } = render(
      <MemoryPage
        memory={undefined}
        onChange={async () => ({ ok: true })}
        onClose={() => {}}
      />,
    );
    expect(screen.getByLabelText("Loading memory")).toBeVisible();
    unmount();

    page({
      memory: undefined,
      failure: "The memory folder could not be read.",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The memory folder could not be read.",
    );
  });
});

describe("a conversation's own memory on the page", () => {
  const trip = { id: "c7", title: "Shanghai trip for Lin" };
  const withTrip: MemoryState = {
    ...memory,
    entries: [
      ...memory.entries,
      entry({
        number: 40,
        scope: "conversation:c7",
        section: "brief",
        title: "Brief",
        summary: "Three days planned, PDF made",
        text: "Open: book the dinner.",
        conversation: trip,
      }),
      entry({
        number: 41,
        scope: "conversation:c7",
        section: "knowledge",
        title: "Flights booked",
        summary: "Land Pudong Fri 27 Nov morning",
        text: "Both on EU passports.",
        conversation: trip,
      }),
    ],
  };

  it("lists each conversation that kept memory for itself, by its title and where it stands", () => {
    page({ memory: withTrip });

    const conversations = screen.getByRole("list", { name: "Conversations" });
    const listed = within(conversations).getByRole("button", {
      name: /Shanghai trip for Lin/,
    });
    expect(listed).toHaveTextContent("Three days planned, PDF made");
  });

  it("shows its brief and its knowledge once chosen, and no instruction of its own", () => {
    page({ memory: withTrip });

    fireEvent.click(
      screen.getByRole("button", { name: /Shanghai trip for Lin/ }),
    );

    expect(screen.getByText("Open: book the dinner.")).toBeVisible();
    expect(knowledgeTitles()).toEqual(["Flights booked"]);
    expect(screen.queryByRole("button", { name: /How to work/ })).toBeNull();
  });

  it("names it where its entries are found, and moves one to everything or a project, never to another conversation", () => {
    page({
      memory: {
        ...withTrip,
        entries: [
          ...withTrip.entries,
          entry({
            number: 50,
            scope: "conversation:c9",
            section: "knowledge",
            title: "Tax deadline",
            conversation: { id: "c9", title: "Tax return" },
          }),
        ],
      },
    });

    fireEvent.change(screen.getByRole("searchbox", { name: "Search memory" }), {
      target: { value: "flights" },
    });
    const results = screen.getByRole("list", { name: "Search results" });
    expect(within(results).getByText("Shanghai trip for Lin")).toBeVisible();

    fireEvent.click(
      within(results).getByRole("button", { name: /Flights booked/ }),
    );
    const keptFor = screen.getByRole("combobox", { name: "Kept for" });
    expect(
      within(keptFor)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Everything you do", "Thesis", "Shanghai trip for Lin"]);
  });

  it("shows no list of conversations while none kept memory for itself", () => {
    page();

    expect(screen.queryByRole("list", { name: "Conversations" })).toBeNull();
  });
});
