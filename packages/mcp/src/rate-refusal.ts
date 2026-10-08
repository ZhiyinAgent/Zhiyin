/**
 * Whether a remote server's answer is a refusal for rate, read from the answer
 * itself. The hosted Tavily server sends one as a result not marked as an
 * error, with `"status": 429` in its JSON, so `isError` cannot be trusted
 * to say.
 *
 * The match is kept narrow because results quote anything: a search result
 * about rate limiting must stay a result. An answer not marked as an error
 * counts only by a top-level status of 429; an error also by its wording.
 */

const refusalWords = /rate limit|too many requests|excessive requests/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const statusIs429 = (value: unknown) =>
  isRecord(value) && (value["status"] === 429 || value["status"] === "429");

function texts(value: Record<string, unknown>): string[] {
  const content = value["content"];
  if (!Array.isArray(content)) return [];
  return content.flatMap((item) =>
    isRecord(item) &&
    item["type"] === "text" &&
    typeof item["text"] === "string"
      ? [item["text"]]
      : [],
  );
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The server's own words for a refusal, or `undefined` when it is not one. */
export function rateRefusal(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const said = texts(value);
  const refused =
    statusIs429(value["structuredContent"]) ||
    said.some((text) => statusIs429(parsed(text))) ||
    (value["isError"] === true && said.some((text) => refusalWords.test(text)));
  return refused ? said.join("\n").slice(0, 500) : undefined;
}
