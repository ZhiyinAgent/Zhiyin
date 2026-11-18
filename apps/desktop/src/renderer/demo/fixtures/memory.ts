import {
  memoryLimits,
  type MemoryEntry,
  type MemoryOutcome,
  type MemoryRequest,
  type MemoryState,
} from "@zhiyin/contract";

/**
 * A doctoral student's memory after a few weeks: what they do in general,
 * their thesis, a kitchen being renovated, and a club newsletter that has
 * nothing kept yet.
 */
const written = "2026-10-03T09:00:00.000Z";

const entries: MemoryEntry[] = [
  {
    number: 1,
    scope: "everything",
    section: "about",
    title: "About you",
    summary: "",
    text: "- PhD student in urban climatology at Université de Lyon, second year.\n- Writes in French and English; answers in the language of the question.\n- Uses metric units and 24-hour times.",
    written,
    used: "2026-10-31T08:00:00.000Z",
  },
  {
    number: 2,
    scope: "everything",
    section: "how",
    title: "How to work",
    summary: "",
    text: "- Short answers first, detail when asked.\n- Ask before restructuring a document I wrote.\n- Cite a source with its link and the date it was checked.",
    written,
    used: "2026-10-31T08:00:00.000Z",
  },
  {
    number: 3,
    scope: "thesis",
    section: "brief",
    title: "Brief",
    summary: "Chapter 3 with Prof. Martin",
    text: "Goal: defend in June 2027.\n\nWhere it stands: chapters 1 and 2 approved; chapter 3 drafted and sent to Prof. Martin on 24 October (#14).\n\nOpen:\n- The August 2025 gap at station 4 (#21).\n- Whether chapter 4 keeps the 2019 heatwave as its case study.",
    written,
    used: "2026-10-30T17:00:00.000Z",
  },
  {
    number: 4,
    scope: "thesis",
    section: "how",
    title: "How to work",
    summary: "",
    text: "- Write in Typst, not LaTeX (#12).\n- Citations in APA 7th, from the Zotero library (#31).\n- Figures as SVG, in the viridis palette.",
    written,
    used: "2026-10-30T17:00:00.000Z",
  },
  {
    number: 12,
    scope: "thesis",
    section: "knowledge",
    title: "Typst over LaTeX",
    summary: "The university template needs a grid the LaTeX class breaks",
    text: "Chosen on 3 October. The graduate school's title page (#13) needs the logo and the jury list on a grid that the LaTeX class breaks at A4. Typst reproduces it exactly.\n\nRejected: Word, because figures move when the text changes.",
    written,
    used: "2026-10-30T17:00:00.000Z",
    conversation: { id: "conversation-1", title: "Thesis template setup" },
  },
  {
    number: 13,
    scope: "thesis",
    section: "knowledge",
    title: "University template rules",
    summary: "Margins, fonts and title page the graduate school requires",
    text: "- Margins 2.5 cm, 3 cm on the binding side.\n- Body in Libertinus Serif, 11 pt.\n- Title page: logo top left, jury list on page 2.\n\nSource: graduate school guide, checked 3 October 2026.",
    written,
    used: "2026-10-22T10:00:00.000Z",
    conversation: { id: "conversation-1", title: "Thesis template setup" },
  },
  {
    number: 14,
    scope: "thesis",
    section: "knowledge",
    title: "Prof. Martin",
    summary: "Supervisor; reviews a chapter in about two weeks",
    text: "Thesis supervisor. Prefers comments in the PDF, not in the text. Reviews a chapter in about two weeks.",
    written: "2026-10-10T09:00:00.000Z",
    used: "2026-10-24T15:00:00.000Z",
    conversation: { id: "conversation-2", title: "Sending chapter 3" },
  },
  {
    number: 21,
    scope: "thesis",
    section: "knowledge",
    title: "August 2025 gap at station 4",
    summary: "Eleven days lost; filled from the Lyon-Bron series",
    text: "Station 4 recorded nothing from 9 to 19 August 2025: a flat battery. Filled from the Météo-France Lyon-Bron series (#30), and marked as filled in every figure that uses it.",
    written: "2026-10-15T09:00:00.000Z",
    used: "2026-10-28T11:00:00.000Z",
    conversation: {
      id: "conversation-3",
      title: "Cleaning the 2025 sensor data",
    },
  },
  {
    number: 30,
    scope: "everything",
    section: "knowledge",
    title: "Météo-France open data",
    summary: "Where hourly station series are, and their licence",
    text: "Hourly series are on meteo.data.gouv.fr under the Licence Ouverte 2.0. Lyon-Bron is station 69029001.\n\nChecked 12 October 2026.",
    written: "2026-10-12T09:00:00.000Z",
    used: "2026-10-28T11:00:00.000Z",
    conversation: {
      id: "conversation-3",
      title: "Cleaning the 2025 sensor data",
    },
  },
  {
    number: 31,
    scope: "everything",
    section: "knowledge",
    title: "Zotero library",
    summary: "Where references are kept and how they reach a document",
    text: "References live in the Zotero group “Thèse”. Better BibTeX keeps refs.bib up to date in the thesis folder, and Typst reads it directly (#12).",
    written,
    used: "2026-10-29T14:00:00.000Z",
    conversation: { id: "conversation-1", title: "Thesis template setup" },
  },
  {
    number: 40,
    scope: "kitchen",
    section: "brief",
    title: "Brief",
    summary: "Leaning towards Atelier Roux",
    text: "Goal: a new kitchen by March.\n\nWhere it stands: three quotes received, leaning towards Atelier Roux (#41).\n\nOpen: whether the wall to the dining room is load-bearing.",
    written: "2026-10-18T09:00:00.000Z",
    used: "2026-10-26T19:00:00.000Z",
  },
  {
    number: 41,
    scope: "kitchen",
    section: "knowledge",
    title: "Quotes compared",
    summary: "Three quotes from €14,200 to €19,800; Atelier Roux best value",
    text: "- Atelier Roux: €15,600, solid oak fronts, eight weeks.\n- Cuisines Delorme: €14,200, laminate fronts, no worktop.\n- Mobalpa: €19,800, includes appliances.\n\nAtelier Roux is the best value once a worktop is added to Delorme's quote.",
    written: "2026-10-26T19:00:00.000Z",
    conversation: { id: "conversation-4", title: "Kitchen quotes" },
  },
  // A conversation in no project keeps memory of its own (ADR 0026).
  {
    number: 50,
    scope: "conversation:conversation-6",
    section: "brief",
    title: "Brief",
    summary: "Three days planned, card sent, dinner to book",
    text: "Goal: three days in Shanghai for Lin's 30th, and a card to send her.\n\nWhere it stands: the plan and the card are made (#51).\n\nOpen: book the dinner on the Bund.",
    written: "2026-10-30T20:00:00.000Z",
    conversation: { id: "conversation-6", title: "Shanghai trip for Lin" },
  },
  {
    number: 51,
    scope: "conversation:conversation-6",
    section: "knowledge",
    title: "Flights booked",
    summary: "Land Pudong Fri 27 Nov morning, home Mon 30 Nov night",
    text: "Both on EU passports, so no visa for a stay under 30 days.",
    written: "2026-10-30T19:40:00.000Z",
    conversation: { id: "conversation-6", title: "Shanghai trip for Lin" },
  },
];

const created = "2026-09-20T09:00:00.000Z";

export const demoMemory: MemoryState = {
  on: true,
  projects: [
    {
      id: "thesis",
      name: "Thesis",
      folders: ["C:\\Users\\Léa\\Thèse"],
      created,
    },
    { id: "kitchen", name: "Kitchen renovation", folders: [], created },
    { id: "newsletter", name: "Running club newsletter", folders: [], created },
  ],
  entries,
  waiting: [
    {
      id: "waiting-1",
      scope: "everything",
      section: "how",
      rule: "In French text, use non-breaking spaces before : ; ? and !",
      conversation: { id: "conversation-9", title: "Chapter 3 proofreading" },
      because: "content from a web page",
      at: "2026-10-30T16:00:00.000Z",
    },
  ],
  limits: memoryLimits,
  broadFolders: [
    "C:\\Users\\Léa",
    "C:\\Users\\Léa\\Documents",
    "C:\\Users\\Léa\\Desktop",
    "C:\\Users\\Léa\\Downloads",
  ],
};

/**
 * A change to the demo's memory as the core would make it, kept in the page:
 * enough for every control to work, nothing kept anywhere.
 */
export function changedMemory(
  memory: MemoryState,
  request: MemoryRequest,
  removed: Map<string, MemoryEntry>,
): { readonly memory: MemoryState; readonly outcome: MemoryOutcome } {
  const entries = (change: (all: MemoryEntry[]) => MemoryEntry[]) => ({
    memory: { ...memory, entries: change([...memory.entries]) },
    outcome: { ok: true } as const,
  });
  switch (request.kind) {
    case "switch":
      return { memory: { ...memory, on: request.on }, outcome: { ok: true } };
    case "add": {
      const number =
        Math.max(0, ...memory.entries.map((one) => one.number)) + 1;
      return {
        memory: {
          ...memory,
          entries: [
            ...memory.entries,
            {
              number,
              scope: request.draft.scope,
              section: request.draft.section,
              title: request.draft.title ?? "",
              summary: request.draft.summary ?? "",
              text: request.draft.text,
              written: new Date().toISOString(),
            },
          ],
        },
        outcome: { ok: true, number },
      };
    }
    case "edit":
      return entries((all) =>
        all.map((one) =>
          one.number === request.number
            ? {
                ...one,
                title: request.edit.title ?? one.title,
                summary: request.edit.summary ?? one.summary,
                text: request.edit.text ?? one.text,
              }
            : one,
        ),
      );
    case "remove": {
      const writeId = `demo-removal-${request.number}`;
      const entry = memory.entries.find((one) => one.number === request.number);
      if (entry) removed.set(writeId, entry);
      return {
        ...entries((all) => all.filter((one) => one.number !== request.number)),
        outcome: { ok: true, writeId },
      };
    }
    case "undo": {
      const entry = removed.get(request.writeId);
      removed.delete(request.writeId);
      return entry
        ? entries((all) => [...all, entry])
        : { memory, outcome: { ok: false, reason: "Nothing to take back." } };
    }
    case "forgetConversation":
      return entries((all) =>
        all.filter((one) => one.conversation?.id !== request.taskId),
      );
    case "keep":
    case "discard": {
      const waiting = memory.waiting.find(
        (one) => one.id === request.waitingId,
      );
      const rest = memory.waiting.filter((one) => one !== waiting);
      const kept =
        request.kind === "keep" && waiting
          ? memory.entries.map((one) =>
              one.scope === waiting.scope && one.section === waiting.section
                ? { ...one, text: `${one.text}\n- ${waiting.rule}` }
                : one,
            )
          : memory.entries;
      return {
        memory: { ...memory, entries: kept, waiting: rest },
        outcome: { ok: true },
      };
    }
    default:
      return {
        memory,
        outcome: { ok: false, reason: "The demo does not change projects." },
      };
  }
}
