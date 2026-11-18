/**
 * The words an approval's rows are made of: numbers trimmed to four figures,
 * lengths in millimetres under a metre and in metres from one, sizes, points
 * and pixels, and names listed, each read from a call's inputs as given.
 */

import type { ToolArgument } from "@zhiyin/contract";

export type Args = Readonly<Record<string, unknown>>;
export type Row = Pick<ToolArgument, "name" | "value" | "readable" | "runs">;

export const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
export const numbers = (value: unknown): readonly number[] | undefined =>
  Array.isArray(value) && value.length > 0 && value.every(isNumber)
    ? value
    : undefined;
export const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value : undefined;
export const record = (value: unknown): Args =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Args)
    : {};
export const list = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : [];
export const names = (value: unknown) =>
  list(value)
    .map((item) => text(item))
    .filter(Boolean)
    .join(", ");
export const trimmed = (value: number) => String(Number(value.toPrecision(4)));
export const row = (name: string, value: string | undefined): Row[] =>
  value ? [{ name, value }] : [];

/** Whether a length reads in millimetres: under 1000 once rounded, so 0.99999 m reads 1 m. */
const inMillimetres = (metres: number) =>
  Math.abs(Number(trimmed(metres * 1000))) < 1000;

export function length(metres: number): string {
  return inMillimetres(metres)
    ? `${trimmed(metres * 1000)} mm`
    : `${trimmed(metres)} m`;
}

export function size(value: unknown): string | undefined {
  const found = numbers(value);
  if (!found) return undefined;
  const small = inMillimetres(Math.max(...found.map(Math.abs)));
  return `${found.map((v) => trimmed(small ? v * 1000 : v)).join(" × ")} ${small ? "mm" : "m"}`;
}

export function point(value: unknown): string | undefined {
  const found = numbers(value);
  if (!found) return undefined;
  const small = inMillimetres(Math.max(...found.map(Math.abs)));
  return `(${found.map((v) => trimmed(small ? v * 1000 : v)).join(", ")} ${small ? "mm" : "m"})`;
}

export const pixels = (value: unknown) => {
  const found = numbers(value);
  return found ? `${found.join(" × ")} pixels` : undefined;
};
