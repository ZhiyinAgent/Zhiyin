import { describe, expect, it } from "vitest";
import { travelsSecurely } from "../src/index.js";

// Each address as a parsed URL gives it.
describe("an address a connection may use", () => {
  it.each([
    ["https:", "search.example"],
    ["https:", "192.168.1.20"],
    ["http:", "localhost"],
    ["http:", "127.0.0.1"],
    ["http:", "[::1]"],
  ])("accepts %s//%s", (protocol, hostname) => {
    expect(travelsSecurely({ protocol, hostname })).toBe(true);
  });

  it.each([
    ["http:", "search.example"],
    ["http:", "192.168.1.20"],
    ["http:", "127.0.0.2"],
    ["http:", "localhost.search.example"],
    ["ftp:", "localhost"],
  ])("refuses %s//%s", (protocol, hostname) => {
    expect(travelsSecurely({ protocol, hostname })).toBe(false);
  });
});
