/**
 * The rules every decision record follows, so that "ADR 0017" names exactly
 * one decision and every record says where it stands in the same words.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const folder = "docs/decisions";
const template = "0000-template.md";

/** Every record but the template, as its file name and text. */
export async function readDecisions() {
  const files = (await readdir(folder)).filter(
    (file) => file.endsWith(".md") && file !== template,
  );
  return Promise.all(
    files.sort().map(async (file) => ({
      file,
      text: await readFile(join(folder, file), "utf8"),
    })),
  );
}

/** What is wrong with the records, one sentence each; empty when nothing is. */
export function checkDecisions(records) {
  const problems = [];
  const byNumber = new Map();
  for (const { file, text } of records) {
    const number = /^(\d{4})-[a-z0-9-]+\.md$/.exec(file)?.[1];
    if (!number) {
      problems.push(`${file} is not named NNNN-slug.md.`);
      continue;
    }
    byNumber.set(number, [...(byNumber.get(number) ?? []), file]);
    const [heading, ...rest] = text.split(/\r?\n/);
    if (!heading?.startsWith(`# ${number}. `))
      problems.push(`${file} must open with "# ${number}. " and its title.`);
    const status = rest.find((line) => line.trim() !== "");
    if (!status?.startsWith("Status: "))
      problems.push(
        `${file} must state "Status: " on the first line after its heading.`,
      );
  }
  for (const [number, files] of byNumber)
    if (files.length > 1)
      problems.push(
        `${number} is the number of more than one record: ${files.join(", ")}.`,
      );
  return problems;
}
