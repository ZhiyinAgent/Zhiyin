/**
 * The model list is one file for every lab, read strictly (ADR 0031): only
 * the labs this version reaches, only the fields the format has, only values
 * a real model could have. The list Zhiyin ships reads the same way, and the
 * one published on GitHub is signed by a key Zhiyin ships.
 */

import { createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readModelList } from "../src/model-list-format.js";
import { modelListKeys } from "../src/model-list-keys.js";
import { labPlatforms, shippedModelList } from "../src/shipped-model-list.js";

const shippedFile = new URL("../model-list/models.json", import.meta.url);

async function shippedValue(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(shippedFile, "utf8")) as Record<
    string,
    unknown
  >;
}

describe("the model list", () => {
  it("Zhiyin ships reads in this version's format, with every lab it reaches", () => {
    expect(Object.keys(shippedModelList.labs).sort()).toEqual(
      [...labPlatforms.keys()].sort(),
    );
  });

  it("passes over a lab this version does not reach, and reads the rest", async () => {
    const value = await shippedValue();
    const reading = readModelList(
      {
        ...value,
        labs: {
          ...(value["labs"] as object),
          "a-later-lab": { anything: "a later version reads" },
        },
      },
      labPlatforms,
    );

    expect(reading.ok && Object.keys(reading.list.labs)).not.toContain(
      "a-later-lab",
    );
    expect(reading.ok && reading.list.labs["deepseek"]).toEqual(
      shippedModelList.labs["deepseek"],
    );
  });

  it("is not read in a format other than this version's", async () => {
    expect(
      readModelList({ ...(await shippedValue()), format: 2 }, labPlatforms),
    ).toEqual({
      ok: false,
      problem: "The list is in format 2, which this version does not read.",
    });
  });

  /** The shipped list with its first Anthropic model changed by `change`. */
  async function withFirstModel(
    change: (model: Record<string, unknown>) => Record<string, unknown>,
  ) {
    const value = await shippedValue();
    const labs = value["labs"] as Record<string, { models: object[] }>;
    const anthropic = labs["anthropic"]!;
    const [first, ...rest] = anthropic.models as Record<string, unknown>[];
    return readModelList(
      {
        ...value,
        labs: {
          ...labs,
          anthropic: { ...anthropic, models: [change(first!), ...rest] },
        },
      },
      labPlatforms,
    );
  }

  const reasoningOf = (model: Record<string, unknown>) =>
    model["reasoning"] as Record<string, unknown>;

  it.each([
    [
      "an effort Zhiyin does not send",
      (model: Record<string, unknown>) => ({
        ...model,
        reasoning: { ...reasoningOf(model), efforts: ["ultra"] },
      }),
      "labs.anthropic.models[0].reasoning.efforts[0] is not an effort Zhiyin sends.",
    ],
    [
      "a default effort the model does not list",
      (model: Record<string, unknown>) => ({
        ...model,
        reasoning: { ...reasoningOf(model), efforts: ["low"] },
      }),
      "labs.anthropic.models[0].reasoning.defaultEffort is not one of its efforts.",
    ],
    [
      "a window that is not a whole number of tokens",
      (model: Record<string, unknown>) => ({ ...model, contextWindow: 1.5 }),
      "labs.anthropic.models[0].contextWindow is not a whole number from 1 to 100000000.",
    ],
    [
      "a longest reply above the window",
      (model: Record<string, unknown>) => ({
        ...model,
        maximumOutputTokens: 2_000_000,
      }),
      "labs.anthropic.models[0].maximumOutputTokens is not a whole number from 1 to 1000000.",
    ],
  ])("refuses %s", async (_name, change, problem) => {
    expect(await withFirstModel(change)).toEqual({ ok: false, problem });
  });

  // The published list must carry a signature by a shipped key, or no
  // installed app takes it. There is no key until the maintainers make one.
  it.skipIf(Object.keys(modelListKeys).length === 0)(
    "published on GitHub is signed by a key Zhiyin ships",
    async () => {
      const bytes = await readFile(shippedFile);
      const signature = JSON.parse(
        await readFile(new URL(`${shippedFile.href}.sig`), "utf8"),
      ) as { key: string; version: number; signature: string };
      const spki = modelListKeys[signature.key];

      expect(spki).toBeDefined();
      expect(signature.version).toBe(shippedModelList.version);
      expect(
        verify(
          null,
          bytes,
          createPublicKey({
            key: Buffer.from(spki ?? "", "base64"),
            format: "der",
            type: "spki",
          }),
          Buffer.from(signature.signature, "base64"),
        ),
      ).toBe(true);
    },
  );
});
