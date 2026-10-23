// @vitest-environment node
/**
 * The window asks the question; the shipped plugin catalog says what the
 * answers are. This is the one place the two lists meet, so drift between them
 * fails here rather than as an interest a person can choose and the core then
 * refuses.
 */

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadBuiltInPlugins } from "@zhiyin/plugins";
import { interestOptions } from "./renderer/ui/onboarding/index.js";

const shipped = fileURLToPath(
  new URL("../../../packages/plugins/built-in", import.meta.url),
);

describe("onboarding interests", () => {
  it("offers exactly the built-in plugins, in catalog order", async () => {
    expect(interestOptions.map((option) => option.id)).toEqual(
      (await loadBuiltInPlugins(shipped)).map((plugin) => plugin.manifest.name),
    );
  });
});
