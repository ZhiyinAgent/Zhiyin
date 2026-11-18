import { describe, expect, it } from "vitest";
import { debuggingRefusal } from "../src/index.js";

/**
 * Chromium's debugging switches let any program that starts Zhiyin drive its
 * window, approvals included. The installed app refuses to start with either
 * and says which; a build run from source keeps them for whoever works on it.
 */

const given =
  (...switches: string[]) =>
  (name: string) =>
    switches.includes(name);

describe("Chromium's debugging switches", () => {
  it("keep the installed app from starting, and the reason names the port switch", () => {
    expect(debuggingRefusal(given("remote-debugging-port"), true)).toMatch(
      /--remote-debugging-port/,
    );
  });

  it("keep the installed app from starting, and the reason names the pipe switch", () => {
    expect(debuggingRefusal(given("remote-debugging-pipe"), true)).toMatch(
      /--remote-debugging-pipe/,
    );
  });

  it("are both named when both are given", () => {
    const reason = debuggingRefusal(
      given("remote-debugging-port", "remote-debugging-pipe"),
      true,
    );
    expect(reason).toMatch(/--remote-debugging-port/);
    expect(reason).toMatch(/--remote-debugging-pipe/);
  });

  it("leave the installed app to start when neither is given", () => {
    expect(
      debuggingRefusal(given("user-data-dir", "lang"), true),
    ).toBeUndefined();
  });

  it("are honoured by a build run from source", () => {
    expect(
      debuggingRefusal(
        given("remote-debugging-port", "remote-debugging-pipe"),
        false,
      ),
    ).toBeUndefined();
  });
});
