/**
 * Which provider and model answer, and which upstreams may serve it, kept
 * across restarts.
 *
 * They are written as one document because a model belongs to the provider it
 * was chosen on, and an upstream list to the model. Writes run one at a time
 * and land through a temporary file, so two saves in flight cannot interleave
 * into a half-applied choice (ADR 0007).
 */

import { mkdir, readFile } from "node:fs/promises";
import { replaceFile } from "@zhiyin/files";
import { Serial } from "@zhiyin/one-at-a-time";
import { join } from "node:path";

export type ModelChoiceValue = {
  /**
   * Who the model is reached through. The person's choice names it, and one
   * that does not is no choice; the choice one provider's own client is
   * handed leaves it out.
   */
  readonly provider?: string;
  /** The platform the person holds an account on, where the provider has two. */
  readonly region?: string;
  readonly model: string;
  /** Empty means unrestricted routing, which is the default. */
  readonly providers: readonly string[];
};

export interface ModelChoice {
  /** Absent until the person chooses one: nobody chooses for them. */
  current(): Promise<ModelChoiceValue | undefined>;
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
  const named = (field: "provider" | "region") =>
    typeof item[field] === "string" && item[field] !== ""
      ? { [field]: item[field] }
      : {};
  return {
    ...named("provider"),
    ...named("region"),
    model: item["model"],
    providers: Array.isArray(providers)
      ? providers.filter((slug): slug is string => typeof slug === "string")
      : [],
  };
}

export class FileModelChoice implements ModelChoice {
  readonly #directory: string;
  readonly #file: string;
  readonly #writes = new Serial();

  constructor(directory: string) {
    this.#directory = directory;
    this.#file = join(directory, "model-choice.json");
  }

  async current(): Promise<ModelChoiceValue | undefined> {
    let source: string;
    try {
      source = await readFile(this.#file, "utf8");
    } catch {
      // No choice made yet, or the file is unreadable: no model, so the
      // person is asked to choose one rather than answered by a model they
      // never picked.
      return undefined;
    }
    try {
      return stored(JSON.parse(source) as unknown);
    } catch {
      return undefined;
    }
  }

  async set(value: ModelChoiceValue): Promise<void> {
    const model = value.model.trim();
    if (!model) throw new ModelChoiceError("Choose a model before saving.");
    const next: ModelChoiceValue = {
      ...(value.provider ? { provider: value.provider } : {}),
      ...(value.region ? { region: value.region } : {}),
      model,
      providers: [...new Set(value.providers.filter((slug) => slug.trim()))],
    };
    await this.#writes.run(() => this.#write(next));
  }

  async #write(value: ModelChoiceValue): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    try {
      await replaceFile(this.#file, JSON.stringify(value, null, 2));
    } catch {
      throw new ModelChoiceError("The model choice could not be saved.");
    }
  }
}
