import { describe, expect, it } from "vitest";
import { offeredReasoning, type ReasoningCapabilities } from "../src/index.js";

const tiers: ReasoningCapabilities = {
  status: "available",
  required: false,
  defaultEnabled: true,
  defaultEffort: "medium",
  efforts: ["low", "medium", "high"],
};

const onOrOff: ReasoningCapabilities = {
  status: "available",
  required: false,
  defaultEnabled: true,
  efforts: [],
};

describe("a chosen reasoning setting as the model can take it", () => {
  it("keeps an effort the model offers", () => {
    expect(offeredReasoning(tiers, { enabled: true, effort: "high" })).toEqual({
      enabled: true,
      effort: "high",
    });
  });

  it("asks for the model's default effort in place of one it does not offer", () => {
    expect(offeredReasoning(tiers, { enabled: true, effort: "xhigh" })).toEqual(
      { enabled: true, effort: "medium" },
    );
  });

  it("asks for reasoning without an effort where the model names none", () => {
    expect(
      offeredReasoning(onOrOff, { enabled: true, effort: "xhigh" }),
    ).toEqual({ enabled: true });
  });

  it("turns reasoning on where the model requires it", () => {
    expect(
      offeredReasoning({ ...tiers, required: true }, { enabled: false }),
    ).toEqual({ enabled: true, effort: "medium" });
    expect(offeredReasoning(tiers, { enabled: false })).toEqual({
      enabled: false,
    });
  });

  it("is left as chosen where the model's controls are unknown, and nothing where nothing was chosen", () => {
    const unknown: ReasoningCapabilities = {
      status: "unavailable",
      reason: "Not read yet.",
      lookupFailed: true,
    };
    expect(
      offeredReasoning(unknown, { enabled: true, effort: "xhigh" }),
    ).toEqual({ enabled: true, effort: "xhigh" });
    expect(offeredReasoning(undefined, { enabled: false })).toEqual({
      enabled: false,
    });
    expect(offeredReasoning(tiers, undefined)).toBeUndefined();
  });

  it("is nothing for a model that offers no reasoning", () => {
    const none: ReasoningCapabilities = {
      status: "unavailable",
      reason: "Reasoning settings are unavailable for this model.",
    };
    expect(
      offeredReasoning(none, { enabled: true, effort: "high" }),
    ).toBeUndefined();
    expect(offeredReasoning(none, { enabled: false })).toBeUndefined();
  });
});
