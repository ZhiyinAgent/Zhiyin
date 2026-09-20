/**
 * Which model answers, and which upstreams may serve it, kept across restarts.
 *
 * The pair is written as one document because a provider list belongs to the
 * model it was chosen for. Writes are serialized on a single promise chain and
 * land through a temporary file, so two saves in flight cannot interleave into
 * a half-applied choice (ADR 0012).
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type ModelChoiceValue = {
  readonly model: string;
  /** Empty means unrestricted routing, which is the default. */
  readonly providers: readonly string[];
};

export interface ModelChoice {
  current(): Promise<ModelChoiceValue>;
  set(value: ModelChoiceValue): Promise<void>;
}

export class ModelChoiceError extends Error {
  readonly code: "unavailable";

  constructor(message: string) {
    super(message);
    this.name = "ModelChoiceError";
    this.code = "unavailable";
  }
}

function stored(value: unknown): ModelChoiceValue | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item["model"] !== "string" || item["model"] === "")
    return undefined;
  const providers = item["providers"];
  return {
    model: item["model"],
    providers: Array.isArray(providers)
      ? providers.filter((slug): slug is string => typeof slug === "string")
      : [],
  };
}

export class FileModelChoice implements ModelChoice {
  readonly #directory: string;
  readonly #file: string;
  readonly #fallback: ModelChoiceValue;
  #writes: Promise<unknown> = Promise.resolve();

  constructor(directory: string, fallback: ModelChoiceValue) {
    this.#directory = directory;
    this.#file = join(directory, "model-choice.json");
    this.#fallback = fallback;
  }

  async current(): Promise<ModelChoiceValue> {
    let source: string;
    try {
      source = await readFile(this.#file, "utf8");
    } catch {
      // No choice made yet, or the file is unreadable: the built-in default
      // still runs the app rather than leaving it with no model at all.
      return this.#fallback;
    }
    try {
      return stored(JSON.parse(source) as unknown) ?? this.#fallback;
    } catch {
      return this.#fallback;
    }
  }

  async set(value: ModelChoiceValue): Promise<void> {
    const model = value.model.trim();
    if (!model) throw new ModelChoiceError("Choose a model before saving.");
    const next: ModelChoiceValue = {
      model,
      providers: [...new Set(value.providers.filter((slug) => slug.trim()))],
    };
    this.#writes = this.#writes.then(
      () => this.#write(next),
      () => this.#write(next),
    );
    await this.#writes;
  }

  async #write(value: ModelChoiceValue): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    const temporary = `${this.#file}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
      await rename(temporary, this.#file);
    } catch {
      throw new ModelChoiceError("The model choice could not be saved.");
    }
  }
}
