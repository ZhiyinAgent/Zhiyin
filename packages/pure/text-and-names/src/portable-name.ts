/**
 * The portable name a name a person gave becomes. The rule a portable name
 * keeps, `portableName`, is the contract's; the plugins, the core and the
 * window make names by this one function, so a name one of them makes the
 * others accept.
 */

import { portableNameLength } from "@zhiyin/contract";

/**
 * The portable name a name a person gave becomes: its Latin letters and
 * digits as words joined by hyphens. A name with none, such as one written in
 * Chinese, becomes `kind` and a short code made from the name, the same each
 * time, so that it can be saved under a name of its own while the person's
 * name stays as they wrote it. A name that also has letters it cannot keep
 * ends in that code, so "数据 v2" and "图表 v2" stay two names. Nothing for a
 * blank name.
 */
export function portableNameFor(name: string, kind: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  const latin = trimmed
    .normalize("NFKD")
    // An accent is its own character after NFKD: é becomes e.
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  const suffix = /[^\P{L}a-z]|[^\P{N}0-9]/u.test(latin)
    ? `-${code(trimmed)}`
    : "";
  const words = latin
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, portableNameLength - suffix.length)
    .replace(/-$/, "");
  return words ? `${words}${suffix}` : `${kind}-${code(trimmed)}`;
}

/**
 * Whether a name holds an emoji: a character drawn as one, a symbol asked to
 * be drawn as one, a flag or a keycap. A symbol written as text, such as ™ or
 * ✓, is not one. A portable name keeps no emoji, so two names told apart
 * only by theirs would be saved under one; no name a person gives a plugin
 * or its components may hold one.
 */
export function holdsEmoji(name: string): boolean {
  return /\p{Emoji_Presentation}|\p{Extended_Pictographic}\u{FE0F}|\u{20E3}/u.test(
    name,
  );
}

/** A short code for a text: FNV-1a over its UTF-16 units, in base 36. */
function code(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}
