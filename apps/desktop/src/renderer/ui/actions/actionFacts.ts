import type {
  ActionEffects,
  ApprovalRequest,
  AskReason,
  FileChange,
} from "@zhiyin/contract";
import type { Icon } from "../shared/index.js";

type IconName = Parameters<typeof Icon>[0]["name"];

/** A web address by its site, anything else as it is written. */
function placeName(place: string): string {
  try {
    const url = new URL(place);
    if ((url.protocol === "http:" || url.protocol === "https:") && url.host)
      return url.host;
  } catch {
    // Not an address: a repository or a service named in words.
  }
  return place;
}

/**
 * The kind of action, drawn as its card's one icon. Told by what the action
 * declared, the files it changes and whether it goes to a connection; never by
 * its title or its tool's name, which the model or a connection may choose.
 */
export function actionKind({
  effects,
  changes,
  connector = false,
}: {
  effects?: ActionEffects | undefined;
  changes?: readonly FileChange[] | undefined;
  /** It goes to a connection rather than to Zhiyin's own tools. */
  connector?: boolean;
}): IconName {
  if (
    changes?.some(
      (change) => change.change === "recycled" || change.change === "deleted",
    )
  )
    return "trash";
  if (effects) {
    if (effects.runs !== "none") return "code";
    if (effects.actsAsPerson !== "none" || effects.reads === "account")
      return "user";
    if (effects.changes === "app") return "settings";
    if (effects.changes !== "none" || changes?.length) return "file";
    if (effects.sends === "chosen" || effects.brings === "outside")
      return "globe";
    if (effects.sends === "service") return "plug";
    if (effects.reads !== "none") return "file";
    return "spark";
  }
  if (changes?.length) return "file";
  return connector ? "plug" : "spark";
}

/**
 * One action's changes with each move as one entry. A move names the file at
 * both ends, and both say the same thing, so the end it arrives at is left
 * out, and the folder made for it is said at the end it leaves.
 */
export function oneEntryPerMove(
  changes: readonly FileChange[],
): readonly FileChange[] {
  const arrivals = new Map(
    changes
      .filter(
        (change) => change.change === "created" && change.from !== undefined,
      )
      .map((change) => [`${change.from}\n${change.path}`, change]),
  );
  if (!arrivals.size) return changes;
  const paired = new Set<FileChange>();
  const shown: FileChange[] = [];
  for (const change of changes) {
    const arrival =
      change.change === "moved"
        ? arrivals.get(`${change.path}\n${change.to}`)
        : undefined;
    if (arrival) paired.add(arrival);
    shown.push(
      arrival?.createdFolder
        ? { ...change, createdFolder: arrival.createdFolder }
        : change,
    );
  }
  return shown.filter((change) => !paired.has(change));
}

/**
 * Which part of the policy asked, and, when several parts did together, each
 * of them.
 */
export type AskedWhy = NonNullable<ApprovalRequest["why"]> & {
  readonly parts?: readonly AskReason[];
};

/**
 * Why the person is asked, as the card says it: a short label for each
 * reason, read at a glance, a clause after it that says what it means, and
 * the whole explanation a press away (ADR 0012). The policy's own reason is
 * for the audit; this is the card's.
 */
export type AskedReason = {
  readonly labels: readonly string[];
  /** One clause read on the card after the labels; absent for several reasons. */
  readonly short?: string;
  readonly explanation: string;
};

/**
 * The parts of the policy that ask for a decision a grant may cover, read from
 * what the action declared, for a question asked for several of them that
 * does not list them.
 */
function coverableParts(effects: ActionEffects | undefined): AskReason[] {
  if (!effects) return [];
  return [
    ...(effects.actsAsPerson === "once" ? (["acts-as-you"] as const) : []),
    ...(effects.changes === "elsewhere" || effects.reads === "elsewhere"
      ? (["outside-folder"] as const)
      : []),
  ];
}

/** One part of the policy, in the card's words. */
function oneReason(
  why: AskedWhy,
  effects: ActionEffects | undefined,
): AskedReason | undefined {
  const place = effects?.destination
    ? placeName(effects.destination)
    : undefined;
  switch (why.code) {
    case "runs-later":
      return {
        labels: ["Runs later"],
        short: "it sets up something that runs later without you starting it.",
        explanation:
          "This sets up something that runs later without you starting it, such as a Git hook or a program that starts with Windows. Zhiyin asks about this every time.",
      };
    case "full-access":
      return {
        labels: ["Full access"],
        short:
          "it can change anything your Windows account can; only this folder can be undone.",
        explanation:
          "A command runs with your Windows account's access, not in Zhiyin's sandbox. What it changes in this conversation's folder can be undone; anything else it touches can't.",
      };
    case "cannot-undo":
      return {
        labels: ["No undo"],
        short: "Zhiyin can't keep a copy first, so this can't be undone.",
        explanation:
          "Zhiyin can't keep a copy of what this changes first, as with a permanent delete or a file too large to copy, so it can't be undone.",
      };
    case "acts-for-good":
      return {
        labels: ["Uses your account", "No undo"],
        short: "it acts as you and can't be taken back.",
        explanation: `This acts as you${place ? ` on ${place}` : ""} in a way that can't be taken back, such as publishing or deleting.`,
      };
    case "outside-and-private":
      return {
        labels: [place ? `Sends to ${place}` : "Sends what it wrote"],
        short:
          "it sends text the AI wrote, after this conversation read outside content.",
        explanation: `This conversation has read content someone else wrote${why.outsideFrom ? `, from ${why.outsideFrom}` : ""}, and this sends text the AI wrote${place ? ` to ${place}` : ""}. You check it so nothing private leaves without you seeing it.`,
      };
    case "acts-as-you":
      return {
        labels: ["Uses your account"],
        short: place
          ? `it acts as you on ${place}, where others can see it.`
          : "it acts as you on an account others can see.",
        explanation: place
          ? `This acts as you on ${place}, where others can see it. You can allow it there for the rest of the conversation.`
          : "This acts as you on an account others can see, and Zhiyin can't tell where, so it asks each time.",
      };
    case "outside-folder":
      return {
        labels: ["Outside this folder"],
        short: "it reads or changes files outside this conversation's folder.",
        explanation:
          "This reads or changes files outside the folder this conversation works in.",
      };
    case "connected-tool":
      return {
        labels: ["First use"],
        short: "Zhiyin can't check what this connected tool does.",
        explanation:
          "Zhiyin can't check what a tool from a connector you added does, so it asks the first time in each conversation. You can change this for each tool in Settings.",
      };
    case "you-asked-each-time":
      return {
        labels: ["Your setting"],
        short: "you asked to be asked about this tool every time.",
        explanation:
          "You chose in Settings to be asked about this tool every time.",
      };
    case "plugin-beyond-read":
      return {
        labels: ["Plugin action"],
        short: "this plugin does more than read what it holds.",
        explanation:
          "Plugins and skills only read what they contain without asking. This one does more.",
      };
    case "several":
      return undefined;
  }
}

/**
 * Why the person is asked, from the part of the policy that asked. A question
 * asked for several reasons carries each one's label, and explains each.
 */
export function askedReason(
  why: AskedWhy | undefined,
  effects?: ActionEffects,
): AskedReason | undefined {
  if (!why) return undefined;
  if (why.code !== "several") return oneReason(why, effects);
  const parts = (why.parts?.length ? why.parts : coverableParts(effects))
    .filter((code) => code !== "several")
    .map((code) => oneReason({ code }, effects))
    .filter((said): said is AskedReason => Boolean(said));
  if (!parts.length)
    return {
      labels: ["Several reasons"],
      explanation: "This does more than one thing that needs your OK.",
    };
  return {
    labels: [...new Set(parts.flatMap((part) => part.labels))],
    ...(parts.length === 1 && parts[0]?.short ? { short: parts[0].short } : {}),
    explanation: parts.map((part) => part.explanation).join(" "),
  };
}
