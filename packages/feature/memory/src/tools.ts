/**
 * The tools the model keeps and reads memory with (ADR 0026), and how their
 * input is read.
 */

import {
  memoryLimits,
  type MemorySection,
  type ToolSpec,
} from "@zhiyin/contract";
import { bytesForTokens } from "@zhiyin/context-budget";

/**
 * A limit in estimated tokens as characters a model can count: three bytes
 * a token, less the room a list line's number takes, rounded down; a
 * Chinese or Japanese character is three bytes.
 */
function characters(tokens: number, taken = 0): string {
  const latin = Math.floor((bytesForTokens(tokens) - taken) / 10) * 10;
  const wide = Math.floor(latin / 3 / 5) * 5;
  return `at most about ${latin.toLocaleString("en-US")} characters, or ${wide.toLocaleString("en-US")} in Chinese or Japanese`;
}

/**
 * `remember` as a conversation is offered it (ADR 0026): the scopes it can
 * use, its own and everything the person does, and the limits said before
 * the first write.
 */
export function rememberToolFor(inProject: boolean): ToolSpec {
  const own = inProject ? "project" : "conversation";
  const ownSaid = inProject
    ? "this project only"
    : "this conversation's work only; it goes with the conversation into a project if it joins one";
  return {
    name: "remember",
    label: "Memory",
    access: "change",
    description: [
      "Keeps what will matter in later conversations, or changes or removes what is kept. What you keep shows in the conversation, and the person can undo it.",
      "Keep: the person's corrections and lasting preferences; decisions, with the reason and what was rejected; where the work stands, when that changes; facts established, with their source and the date checked.",
      "Do not keep: a fix that worked once (keep it once it is known to hold, as what it is and why it works); what the files already say; the steps of the current task; anything resting only on a page you read, unconfirmed by the person or the work.",
      "Before keeping something new, recall its subject: change the entry that covers it (by number) rather than adding another.",
      `Scopes: everything, for anything the person does; ${own}, for ${ownSaid}.`,
      "Sections:",
      `- knowledge: a fact, a source, a person and their role, a decision and its reason, where something is kept. New: scope, title, summary (one line, shown in the list you are sent) and text. Link entries by writing #number in the text, where the reason for the link is.`,
      `- how: a rule for how to work, for everything${inProject ? " or only this project" : ""}. One rule a call, in rule, with quote: the person's own words it rests on, exactly as they wrote them in this conversation. replaces names a rule already kept, word for word, to change it; with remove: true and no rule, it is taken out.`,
      "- about: who the person is, the same way as how, for everything only.",
      `- brief: where ${inProject ? "this project" : "this conversation's work"} stands: its goal, state, what is open, deadlines, people. Rewritten whole each time: text, and summary, its one line. Scope ${own}.`,
      "To change a knowledge entry, give its number and the fields that change. To remove one, its number and remove: true, with mergedInto when it was folded into another.",
      `Limits. Title and summary together: ${characters(memoryLimits.line, 10)}. A knowledge entry's text: ${characters(memoryLimits.entry)}. A brief: ${characters(memoryLimits.brief)}.`,
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        number: {
          type: "integer",
          description: "The entry to change or remove.",
        },
        section: {
          type: "string",
          enum: ["knowledge", "how", "about", "brief"],
          description:
            "Needed for everything but a change or removal by number, which keeps the entry's own.",
        },
        scope: {
          type: "string",
          enum: ["everything", own],
          description: `everything: anything the person does. ${own}: ${ownSaid}. Needed for a new knowledge entry or rule. Not read for a brief, which is always ${own}'s, nor for a change or removal by number, which keeps the entry's own.`,
        },
        title: { type: "string" },
        summary: { type: "string", description: "One line." },
        text: { type: "string" },
        rule: {
          type: "string",
          description: "how and about: the rule, one line.",
        },
        replaces: {
          type: "string",
          description: "how and about: a rule already kept, word for word.",
        },
        quote: {
          type: "string",
          description:
            "how and about: the person's words the rule rests on, exactly.",
        },
        remove: { type: "boolean" },
        mergedInto: {
          type: "integer",
          description: "With remove: the entry this one was folded into.",
        },
      },
      additionalProperties: false,
    },
  };
}

/** The most searches one `recall` call answers. */
export const mostSearches = 5;

export const recallTool: ToolSpec = {
  name: "recall",
  label: "Memory",
  access: "read",
  description: [
    "Reads what is kept in memory, across the person's memory, every project's and every conversation's: entries by number, and entries found by searches, several of each in one call.",
    "Entries asked for by number come whole; of those the searches find, the five closest come whole and the others are named by their line, under the search that found them, to read by number next.",
    "Each entry comes with the titles of the entries it links to and that link to it.",
    "Recall what may already be known when a task starts, before you search, measure or ask again.",
  ].join("\n"),
  inputSchema: {
    type: "object",
    properties: {
      numbers: { type: "array", items: { type: "integer" } },
      searches: {
        type: "array",
        items: { type: "string" },
        maxItems: mostSearches,
        description: `Up to ${mostSearches} searches, each a few words.`,
      },
    },
    additionalProperties: false,
  },
};

/** The scope a call asks for: everything, or the conversation's own. */
export type AskedScope = "everything" | "project" | "conversation";

/** A `remember` call, read. */
export type RememberRequest =
  | {
      readonly kind: "new";
      readonly scope: AskedScope;
      readonly title: string;
      readonly summary: string;
      readonly text: string;
    }
  | {
      readonly kind: "change";
      readonly number: number;
      readonly title?: string | undefined;
      readonly summary?: string | undefined;
      readonly text?: string | undefined;
    }
  | {
      readonly kind: "remove";
      readonly number: number;
      readonly mergedInto?: number | undefined;
    }
  | {
      readonly kind: "brief";
      readonly summary?: string | undefined;
      readonly text?: string | undefined;
    }
  | {
      readonly kind: "rule";
      readonly section: "about" | "how";
      readonly scope?: AskedScope | undefined;
      readonly number?: number | undefined;
      readonly rule?: string | undefined;
      readonly replaces?: string | undefined;
      readonly quote: string;
    };

const sections: readonly MemorySection[] = [
  "knowledge",
  "how",
  "about",
  "brief",
];

type Read =
  | { readonly ok: true; readonly request: RememberRequest }
  | { readonly ok: false; readonly reason: string };

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * The call's input as a request; the section of an entry given by number is
 * looked up by the caller, which passes it as `sectionOf`.
 */
export function readRemember(
  input: unknown,
  sectionOf: (number: number) => MemorySection | undefined,
): Read {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { ok: false, reason: "remember takes an object of its fields." };
  const fields = input as Record<string, unknown>;
  const number =
    typeof fields["number"] === "number" ? fields["number"] : undefined;
  const asked = text(fields["section"]);
  if (asked !== undefined && !sections.includes(asked as MemorySection))
    return { ok: false, reason: "section is knowledge, how, about or brief." };
  const scope = text(fields["scope"]);
  if (
    scope !== undefined &&
    scope !== "everything" &&
    scope !== "project" &&
    scope !== "conversation"
  )
    return {
      ok: false,
      reason: 'scope is "everything", or this conversation\'s own as offered.',
    };
  const kept = number === undefined ? undefined : sectionOf(number);
  if (number !== undefined && !kept)
    return {
      ok: false,
      reason: `Nothing is kept as #${number}. To keep something new, leave out number.`,
    };
  const section = kept ?? (asked as MemorySection | undefined);
  if (!section)
    return {
      ok: false,
      reason: "Say which section: knowledge, how, about or brief.",
    };
  const title = text(fields["title"]);
  const summary = text(fields["summary"]);
  const body = text(fields["text"]);
  if (section === "about" || section === "how")
    return {
      ok: true,
      request: {
        kind: "rule",
        section,
        scope: scope as AskedScope | undefined,
        number,
        rule: fields["remove"] === true ? undefined : text(fields["rule"]),
        // A model sends an empty field for one it leaves out.
        replaces: text(fields["replaces"])?.trim() || undefined,
        quote: text(fields["quote"]) ?? "",
      },
    };
  if (section === "brief")
    return { ok: true, request: { kind: "brief", summary, text: body } };
  if (number !== undefined && fields["remove"] === true)
    return {
      ok: true,
      request: {
        kind: "remove",
        number,
        mergedInto:
          typeof fields["mergedInto"] === "number"
            ? fields["mergedInto"]
            : undefined,
      },
    };
  if (number !== undefined)
    return {
      ok: true,
      request: { kind: "change", number, title, summary, text: body },
    };
  if (!title?.trim() || !summary?.trim() || !body?.trim())
    return {
      ok: false,
      reason: "A new Knowledge entry needs a title, a summary and a text.",
    };
  if (!scope)
    return {
      ok: false,
      reason:
        'Say whose it is: scope "everything" for anything the person does, or this conversation\'s own as offered.',
    };
  return {
    ok: true,
    request: {
      kind: "new",
      scope: scope as AskedScope,
      title,
      summary,
      text: body,
    },
  };
}

/** A `recall` call, read: the numbers asked for, and each search with words in it. */
export function readRecall(input: unknown):
  | {
      readonly numbers: readonly number[];
      readonly searches: readonly string[];
    }
  | undefined {
  if (!input || typeof input !== "object") return undefined;
  const fields = input as Record<string, unknown>;
  const numbers = Array.isArray(fields["numbers"])
    ? fields["numbers"].filter((one): one is number =>
        Number.isSafeInteger(one),
      )
    : [];
  const searches = Array.isArray(fields["searches"])
    ? fields["searches"]
        .map((one) => text(one)?.trim() ?? "")
        .filter((one) => one.length > 0)
    : [];
  return numbers.length || searches.length ? { numbers, searches } : undefined;
}
