/**
 * Whether a look choice from outside is one the contract lists (ADR 0028):
 * the core checks what the window sends, and the window what it reads back.
 */

import type { LookChoice, LookId, LookStrength } from "@zhiyin/contract";
import { oneOf } from "./named-values.js";

export const isLookId = oneOf<LookId>({ neutral: true, ink: true, dots: true });

export const isLookStrength = oneOf<LookStrength>({
  subtle: true,
  default: true,
  vivid: true,
});

/** A listed look and a strength, and nothing else. */
export function isLookChoice(value: unknown): value is LookChoice {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 &&
    isLookId(record.look) &&
    isLookStrength(record.strength)
  );
}
