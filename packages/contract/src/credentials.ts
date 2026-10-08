/**
 * Credentials removed from what leaves the computer or reaches the model as
 * evidence. Shared because the agent loop and an export must remove the same
 * ones. It recognises known formats; it cannot prove a text holds none.
 */

/** What a removed credential reads as. */
export const credentialOmitted = "[credential omitted]";

/** A field whose value is a credential, whatever it holds. */
const credentialField =
  /^(?:x[_-])?(?:authorization|password|passwd|secret|client[_-]?secret|token|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|private[_-]?key)$/i;

const credentialKeys =
  "password|passwd|secret|client_secret|token|access_token|refresh_token|id_token|api[_-]?key|apiKey|private_key";

/** Known formats in free text, each keeping what names the credential. */
const credentialText: readonly [RegExp, string][] = [
  [/\b(Authorization\s*:\s*)[^\r\n"']+/gi, `$1${credentialOmitted}`],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi, `$1${credentialOmitted}`],
  [
    new RegExp(`("(?:${credentialKeys})"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, "gi"),
    `$1"${credentialOmitted}"`,
  ],
  [
    /(--(?:password|passwd|token|api-?key|secret)=)[^\s"']+/gi,
    `$1${credentialOmitted}`,
  ],
  [
    /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+(@)/gi,
    `$1${credentialOmitted}$2`,
  ],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, credentialOmitted],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, credentialOmitted],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, credentialOmitted],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, credentialOmitted],
  [/\btvly-[A-Za-z0-9_-]{16,}/g, credentialOmitted],
  [/\bAKIA[0-9A-Z]{16}\b/g, credentialOmitted],
];

/** The text with every recognised credential replaced, never shortened. */
export function textWithoutCredentials(text: string): string {
  return credentialText.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text,
  );
}

/**
 * A copy of the value with credential-named fields blanked and recognised
 * credentials removed from every string in it.
 */
export function withoutCredentials(value: unknown): unknown {
  if (typeof value === "string") return textWithoutCredentials(value);
  if (Array.isArray(value)) return value.map(withoutCredentials);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        credentialField.test(key) && entry !== undefined && entry !== null
          ? credentialOmitted
          : withoutCredentials(entry),
      ]),
    );
  return value;
}
