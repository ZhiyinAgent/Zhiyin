/**
 * Plugins, skills, specialists and connectors are saved under portable names,
 * which every part of the app checks by one rule. A name a person writes in
 * any script becomes one.
 */

import { describe, expect, it } from "vitest";
import { holdsEmoji, portableName, portableNameFor } from "../src/index.js";

describe("the portable name a person's name becomes", () => {
  it("keeps the Latin letters and digits as words joined by hyphens", () => {
    expect(portableNameFor("  Weather Pro 2 ", "plugin")).toBe("weather-pro-2");
    expect(portableNameFor("Café notes", "plugin")).toBe("cafe-notes");
    expect(portableNameFor("Crème brûlée", "plugin")).toBe("creme-brulee");
  });

  it("is the kind and a code, the same each time, for a name with no Latin letters", () => {
    const chinese = portableNameFor("数据分析", "plugin");

    expect(chinese).toMatch(/^plugin-[a-z0-9]+$/);
    expect(portableNameFor("数据分析", "plugin")).toBe(chinese);
    expect(portableNameFor("数据工具", "plugin")).not.toBe(chinese);
    expect(portableName.test(chinese)).toBe(true);
  });

  it("keeps apart two names that differ only in letters it cannot keep", () => {
    const data = portableNameFor("数据 v2", "plugin");
    const chart = portableNameFor("图表 v2", "plugin");

    expect(data).toMatch(/^v2-[a-z0-9]+$/);
    expect(chart).toMatch(/^v2-[a-z0-9]+$/);
    expect(data).not.toBe(chart);
    expect(portableNameFor("数据 v2", "plugin")).toBe(data);
    // Within the longest name, the code included.
    const long = portableNameFor(`数据 ${"a".repeat(200)}`, "plugin");
    expect(long.length).toBeLessThanOrEqual(128);
    expect(portableName.test(long)).toBe(true);
    expect(long).not.toBe(portableNameFor(`图表 ${"a".repeat(200)}`, "plugin"));
  });

  it("is nothing for a blank name", () => {
    expect(portableNameFor("   ", "plugin")).toBe("");
  });
});

describe("a name with emoji", () => {
  it.each([
    "Weather ☀️",
    "Love ❤️",
    "Charts 📊",
    "Trips 🇫🇷",
    "Step 1️⃣",
    "👩‍💻 tools",
  ])("is found in %s", (name) => {
    expect(holdsEmoji(name)).toBe(true);
  });

  it.each([
    "Weather Pro 2",
    "数据分析",
    "Мои инструменты",
    "Crème brûlée",
    "C# & F#",
    "R*",
    // Symbols written as text, not drawn as emoji.
    "Acme™",
    "© Notes",
    "Report ✓",
    "Done ✔",
    "Left ↔ right",
    "Weather ☀",
  ])("is not found in %s", (name) => {
    expect(holdsEmoji(name)).toBe(false);
  });
});
