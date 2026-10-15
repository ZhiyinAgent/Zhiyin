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

/** The last words of a name that make a text value under it a credential. */
const credentialEndings = new Set([
  "secret",
  "password",
  "passwd",
  "passphrase",
  "apikey",
  "api key",
  "private key",
  "secret key",
  "access key",
  "access token",
  "auth token",
  "refresh token",
  "session token",
]);

/**
 * Whether a name says its text value is a credential: `OPENAI_API_KEY`,
 * `openaiApiKey` and `db-password` do. A lower-case name ending in "token"
 * does not, so a model's `eos_token` stays readable; an upper-case one, as in
 * `GITHUB_TOKEN`, does.
 */
function namesCredential(name: string): boolean {
  if (credentialField.test(name)) return true;
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const last = words.at(-1) ?? "";
  return (
    credentialEndings.has(last) ||
    credentialEndings.has(words.slice(-2).join(" ")) ||
    (last === "token" && words.length > 1 && name === name.toUpperCase())
  );
}

/** Not already removed, so removing again changes nothing. */
const notOmitted = String.raw`(?!\[credential omitted\])`;

/** Known formats in free text, each keeping what names the credential. */
const credentialText: readonly [RegExp, string][] = [
  [/\b(Authorization\s*:\s*)[^\r\n"']+/gi, `$1${credentialOmitted}`],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi, `$1${credentialOmitted}`],
  [
    new RegExp(
      String.raw`\b((?:[a-z0-9]+-)*(?:api-key|auth-token|access-token)\s*:\s*)${notOmitted}[^\s"',;]+`,
      "gi",
    ),
    `$1${credentialOmitted}`,
  ],
  [
    new RegExp(
      String.raw`([?&](?:api[_-]?key|apikey|key|access[_-]?token|token|client[_-]?secret|secret|password|sig|signature)=)${notOmitted}[^&#\s"'<>]+`,
      "gi",
    ),
    `$1${credentialOmitted}`,
  ],
  [
    /(--(?:password|passwd|token|api-?key|secret)=)(["'])(?:(?!\2)[^\\\r\n]|\\.)*\2/gi,
    `$1$2${credentialOmitted}$2`,
  ],
  [
    new RegExp(
      String.raw`(--(?:password|passwd|token|api-?key|secret)=)${notOmitted}[^\s"']+`,
      "gi",
    ),
    `$1${credentialOmitted}`,
  ],
  // A user and password given to a command, as curl takes them.
  [
    new RegExp(
      String.raw`(\s(?:-u|--user)(?:\s+|=)["']?[^\s:"']+:)${notOmitted}[^\s"']+`,
      "g",
    ),
    `$1${credentialOmitted}`,
  ],
  [
    /(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g,
    `$1\n${credentialOmitted}\n$2`,
  ],
  [
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    credentialOmitted,
  ],
  [/\bnpm_[A-Za-z0-9]{36}\b/g, credentialOmitted],
  // Zhipu's keys: an id and a secret, joined by a dot.
  [/\b[0-9a-f]{32}\.[A-Za-z0-9]{16}\b/g, credentialOmitted],
  [
    /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+(@)/gi,
    `$1${credentialOmitted}$2`,
  ],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, credentialOmitted],
  [/\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g, credentialOmitted],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, credentialOmitted],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, credentialOmitted],
  [/\bglpat-[A-Za-z0-9_-]{20,}/g, credentialOmitted],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, credentialOmitted],
  [/\btvly-[A-Za-z0-9_-]{16,}/g, credentialOmitted],
  [/\bhf_[A-Za-z0-9]{30,}/g, credentialOmitted],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, credentialOmitted],
  [/\bAKIA[0-9A-Z]{16}\b/g, credentialOmitted],
];

/**
 * A field holding quoted text, its name quoted or not and either quote used:
 * `"name": "value"`, `'name': 'value'`, `name: "value"`.
 */
const quotedField =
  /((["']?)\b([A-Za-z_][\w-]{0,99})\2\s*:\s*)(["'])(?:(?!\4)[^\\\r\n]|\\.)*\4/g;

/** A JSON field holding text, whatever its name: `"OPENAI-KEY": "value"`. */
const jsonText = /("([^"\\\r\n]{1,100})"\s*:\s*)"(?:[^"\\]|\\.)*"/g;

/**
 * A name set to quoted text in code or a shell, whatever the case of the
 * name: `password='x'`, `SECRET="two words"`. Quoted, the value is whole.
 */
const quotedAssignment =
  /\b([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(["'])(?:(?!\3)[^\\\r\n]|\\.)*\3/g;

/**
 * An upper-case variable set to a value, as in a `.env` file, a shell or
 * PowerShell: `NAME=value`, `export NAME="value"`, `$env:NAME = "value"`.
 * With spaces around `=`, only a quoted value counts, so code such as
 * `API_KEY = os.getenv("API_KEY")` is left as it is.
 */
const assignment = new RegExp(
  String.raw`\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)(=["']?|\s*=\s*["'])${notOmitted}[^\s"'#;]+`,
  "g",
);

/** The text with every recognised credential replaced, never shortened. */
export function textWithoutCredentials(text: string): string {
  // Fields and variables go first, so a key with a known prefix is removed
  // whole with its name kept, rather than leaving part of its value behind.
  const named = text
    .replace(jsonText, (field: string, head: string, name: string) =>
      namesCredential(name) ? `${head}"${credentialOmitted}"` : field,
    )
    .replace(
      quotedField,
      (field: string, head: string, _q: string, name: string, quote: string) =>
        namesCredential(name)
          ? `${head}${quote}${credentialOmitted}${quote}`
          : field,
    )
    .replace(
      quotedAssignment,
      (set: string, name: string, between: string, quote: string) =>
        namesCredential(name)
          ? `${name}${between}${quote}${credentialOmitted}${quote}`
          : set,
    )
    .replace(assignment, (set: string, name: string, between: string) =>
      namesCredential(name) ? `${name}${between}${credentialOmitted}` : set,
    );
  return credentialText.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    named,
  );
}

/**
 * A copy of the value with credential-named fields blanked and recognised
 * credentials removed from every string in it.
 */
export function withoutCredentials(value: unknown): unknown {
  if (typeof value === "string") return textWithoutCredentials(value);
  if (Array.isArray(value)) return value.map(withoutCredentials);
  if (value && typeof value === "object") {
    // An entry naming itself, as a call's inputs are listed: its value is
    // what its name says it is.
    const named =
      "name" in value &&
      typeof value.name === "string" &&
      namesCredential(value.name);
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        (credentialField.test(key) && entry !== undefined && entry !== null) ||
        (typeof entry === "string" &&
          (namesCredential(key) || (named && key === "value")))
          ? credentialOmitted
          : withoutCredentials(entry),
      ]),
    );
  }
  return value;
}
