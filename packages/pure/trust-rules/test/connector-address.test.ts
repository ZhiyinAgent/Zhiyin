import { describe, expect, it } from "vitest";
import { addressProblem, type ParsedAddress } from "../src/index.js";

/** The runtime's own URL parser, which a pure package's types do not name. */
const Parser = (
  globalThis as unknown as {
    readonly URL: new (address: string) => ParsedAddress;
  }
).URL;

/** An address as a parsed URL gives it, or nothing when it does not parse. */
const parsed = (address: string) => {
  try {
    return new Parser(address);
  } catch {
    return undefined;
  }
};

describe("what keeps a connector's address from being dialled", () => {
  it.each([
    "https://search.example/mcp",
    "http://localhost:3000/mcp",
    "https://search.example/mcp?region=eu",
  ])("nothing, for %s", (address) => {
    expect(addressProblem(parsed(address))).toBeUndefined();
  });

  it.each([
    ["not an address", "unreadable"],
    ["ftp://files.example/mcp", "not-http"],
    ["http://search.example/mcp", "unencrypted"],
    ["https://ana:secret@search.example/mcp", "credentials"],
    ["https://search.example/mcp?api_key=abc", "credentials"],
    ["https://search.example/mcp?accessToken=abc", "credentials"],
  ])("refuses %s as %s", (address, problem) => {
    expect(addressProblem(parsed(address))).toBe(problem);
  });
});
