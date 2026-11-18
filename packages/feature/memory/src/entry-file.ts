/**
 * An entry's file: a few `key: value` lines between `---` lines, saying what
 * it is, then its text. Written so a person can read and change it in any
 * editor; read so that a file they wrote themselves, with no such lines,
 * still becomes an entry.
 */

import type { MemoryHeld, MemorySection } from "@zhiyin/contract";

/** What an entry's file says of it. Its scope and section come from its place. */
export type EntryFields = {
  readonly number?: number | undefined;
  readonly title: string;
  readonly summary: string;
  readonly text: string;
  readonly written?: string | undefined;
  readonly used?: string | undefined;
  readonly conversation?:
    { readonly id: string; readonly title: string } | undefined;
  readonly held?: MemoryHeld | undefined;
};

const fence = "---";

/** The lines between the fences, by key; nothing when the file has none. */
function headerOf(
  content: string,
): { fields: Map<string, string>; body: string } | undefined {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trim() !== fence) return undefined;
  const end = lines.findIndex(
    (line, index) => index > 0 && line.trim() === fence,
  );
  if (end < 0) return undefined;
  const fields = new Map<string, string>();
  for (const line of lines.slice(1, end)) {
    const colon = line.indexOf(":");
    if (colon > 0)
      fields.set(
        line.slice(0, colon).trim().toLowerCase(),
        line.slice(colon + 1).trim(),
      );
  }
  return { fields, body: lines.slice(end + 1).join("\n") };
}

function heldFrom(value: string | undefined): MemoryHeld | undefined {
  const words = new Set((value ?? "").toLowerCase().split(/[\s,]+/));
  const held = {
    ...(words.has("outside") ? { outside: true as const } : {}),
    ...(words.has("private") ? { private: true as const } : {}),
  };
  return Object.keys(held).length ? held : undefined;
}

/**
 * The entry a file holds. A file with no header takes its title from its
 * first heading, or else from `name`, the file's name.
 */
export function readEntry(content: string, name: string): EntryFields {
  const header = headerOf(content);
  if (!header) {
    const text = content.replace(/\r\n?/g, "\n").trim();
    const heading = /^#{1,6}[ \t]+(.+)$/m.exec(text);
    const start = heading && text.indexOf(heading[0]) === 0;
    return {
      title: (start ? heading[1]! : name).trim(),
      summary: "",
      text: start ? text.slice(heading[0].length).trim() : text,
    };
  }
  const { fields, body } = header;
  const number = Number(fields.get("number"));
  const conversation = fields.get("conversation-id");
  return {
    number: Number.isSafeInteger(number) && number > 0 ? number : undefined,
    title: fields.get("title") ?? name,
    summary: fields.get("summary") ?? "",
    text: body.trim(),
    written: fields.get("written") || undefined,
    used: fields.get("used") || undefined,
    conversation: conversation
      ? { id: conversation, title: fields.get("conversation") ?? "" }
      : undefined,
    held: heldFrom(fields.get("held")),
  };
}

/** An entry's file, with what it says of itself first. */
export function writeEntry(
  entry: EntryFields & { readonly number: number; readonly written: string },
  section: MemorySection,
): string {
  const held = [
    ...(entry.held?.outside ? ["outside"] : []),
    ...(entry.held?.private ? ["private"] : []),
  ];
  return [
    fence,
    `number: ${entry.number}`,
    `title: ${entry.title}`,
    `summary: ${entry.summary}`,
    `section: ${section}`,
    `written: ${entry.written}`,
    ...(entry.used ? [`used: ${entry.used}`] : []),
    ...(entry.conversation
      ? [
          `conversation-id: ${entry.conversation.id}`,
          `conversation: ${entry.conversation.title}`,
        ]
      : []),
    ...(held.length ? [`held: ${held.join(" ")}`] : []),
    fence,
    "",
    entry.text,
    "",
  ].join("\n");
}
