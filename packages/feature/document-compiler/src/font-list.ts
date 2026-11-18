import { dirname } from "node:path";
import type { ConnectionTool, ToolCallInspection } from "@zhiyin/contract";
import type { ProcessContainment, RunProcess } from "@zhiyin/sandbox";

/**
 * The fonts a Typst document can name: those installed on this computer and
 * Typst's own, as Typst itself finds them, so the model never has to look on
 * the command line.
 */
export const fontsTool: ConnectionTool = {
  name: "list_fonts",
  label: "List fonts",
  access: "read",
  description:
    'List the font families a Typst document can name: the fonts installed on this computer and Typst\'s own. Give matching to keep only the families with any of those words, ignoring case, among the words of their name, such as ["YaHei", "SimSun", "SC", "Han"] for Chinese. Use it before choosing a font, rather than the command line.',
  inputSchema: {
    type: "object",
    properties: {
      matching: {
        type: "array",
        items: { type: "string", minLength: 1, maxLength: 60 },
        maxItems: 20,
        description:
          'Words, or runs of words such as "Noto Sans", one of which a family\'s name must have among its words, ignoring case. Leave it out to list every family.',
      },
    },
    additionalProperties: false,
  },
};

/** The words asked for, or a reason they cannot be used. */
export function fontWords(
  args: Readonly<Record<string, unknown>>,
): readonly string[] | { readonly reason: string } {
  const given = args["matching"];
  if (given === undefined) return [];
  if (
    !Array.isArray(given) ||
    given.length > 20 ||
    !given.every(
      (word) =>
        typeof word === "string" && word.trim().length > 0 && word.length <= 60,
    )
  )
    return {
      reason:
        "matching is a list of up to 20 words, each of 1 to 60 characters, or is left out.",
    };
  return given.map((word: string) => word.trim());
}

/** Listing fonts reads no file of the person's and sends nothing anywhere. */
export function inspectFonts(
  words: readonly string[],
): Extract<ToolCallInspection, { ok: true }> {
  return {
    ok: true,
    action: "List fonts",
    target: "Typst",
    command: "typst fonts",
    effects: {
      reads: "none",
      changes: "none",
      sends: "none",
      actsAsPerson: "none",
      runs: "none",
      lasting: false,
      brings: "none",
    },
    ...(words.length
      ? {
          invocation: {
            name: "List fonts",
            arguments: [
              { name: "Matching", value: words.join(", "), readable: true },
            ],
          },
        }
      : {}),
    identity: JSON.stringify({ fonts: words }),
  };
}

/** The words of a name, in lower case, split at spaces, hyphens and underscores. */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean);
}

/** Asks Typst which families it has, and keeps those holding a word asked for. */
export async function listFonts(options: {
  readonly run: RunProcess;
  readonly typst: string;
  readonly words: readonly string[];
  readonly containment?: ProcessContainment;
  readonly signal?: AbortSignal;
}): Promise<{ readonly text: string; readonly failed: boolean }> {
  const { exitCode, stdout, stderr, failure } = await options.run({
    executable: options.typst,
    arguments: ["fonts"],
    cwd: dirname(options.typst),
    timeoutMs: 60_000,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.containment ? { containment: options.containment } : {}),
  });
  if (failure === "containment")
    return {
      text: "Zhiyin could not start Typst inside the limits it runs within, so it did not run.",
      failed: true,
    };
  if (exitCode !== 0)
    return {
      text: `Typst could not list its fonts.${stderr.trim() ? `\n${stderr.trim()}` : ""}`,
      failed: true,
    };
  const every = [
    ...new Set(
      stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
  const lowered = options.words.map((word) => wordsOf(word).join(" "));
  const kept = lowered.length
    ? every.filter((family) => {
        // Matched word for word, so "SC" finds Noto Sans SC but not Script.
        const name = ` ${wordsOf(family).join(" ")} `;
        return lowered.some((word) => name.includes(` ${word} `));
      })
    : every;
  if (!kept.length)
    return {
      text: `None of the ${every.length} font families Typst can use holds ${options.words.map((word) => `“${word}”`).join(" or ")} in its name.`,
      failed: false,
    };
  return {
    text: [
      lowered.length
        ? `${kept.length} of the ${every.length} font families Typst can use hold ${options.words.map((word) => `“${word}”`).join(" or ")} in their name:`
        : `The ${every.length} font families Typst can use:`,
      ...kept,
    ].join("\n"),
    failed: false,
  };
}
