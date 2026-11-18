import { describe, expect, it } from "vitest";
import { allows, hostEntries } from "../src/egress/hosts.js";
import { hostList, hostListProblem } from "../src/index.js";

function entries(hosts: readonly string[]) {
  const made = hostEntries(hosts);
  if (typeof made === "string") throw new Error(made);
  return made;
}

describe("the hosts a run may reach", () => {
  it("lets a run reach a named host on 443, and no other name or port", () => {
    const given = entries(["pypi.org"]);

    expect(allows(given, "pypi.org", 443)).toBe(true);
    expect(allows(given, "files.pypi.org", 443)).toBe(false);
    expect(allows(given, "pypi.org.evil.example", 443)).toBe(false);
    expect(allows(given, "pypi.org", 80)).toBe(false);
  });

  it("lets a run reach every name below a domain given with *., but not the domain itself", () => {
    const given = entries(["*.githubusercontent.com"]);

    expect(allows(given, "raw.githubusercontent.com", 443)).toBe(true);
    expect(allows(given, "a.b.githubusercontent.com", 443)).toBe(true);
    expect(allows(given, "githubusercontent.com", 443)).toBe(false);
    expect(allows(given, "evilgithubusercontent.com", 443)).toBe(false);
  });

  it("takes a port after the name, and an IPv6 address only in brackets with one", () => {
    const given = entries([
      "api.example.com:8443",
      "[2001:db8::1]:8443",
      "2001:db8::2",
    ]);

    expect(allows(given, "api.example.com", 8443)).toBe(true);
    expect(allows(given, "api.example.com", 443)).toBe(false);
    expect(allows(given, "2001:db8::1", 8443)).toBe(true);
    expect(allows(given, "2001:db8::2", 443)).toBe(true);
  });

  it("compares names without case, a final dot, or their Unicode form", () => {
    const given = entries(["PyPI.org.", "bücher.example"]);

    expect(allows(given, "pypi.org", 443)).toBe(true);
    expect(allows(given, "xn--bcher-kva.example", 443)).toBe(true);
  });

  it("shows each host once, in order, in the form it is compared in", () => {
    expect(hostList(["PyPI.org", "pypi.org", "api.example.com:8443"])).toEqual([
      "api.example.com:8443",
      "pypi.org",
    ]);
  });

  it.each([
    ["https://pypi.org/simple", "without a scheme or path"],
    ["pypi.org/simple", "without a scheme or path"],
    ["user@pypi.org", "without a scheme or path"],
    ["*.com", "too wide"],
    ["*", "is not a host"],
    ["*.10.0.0.1", "too wide"],
    ["localhost", "this computer"],
    ["api.localhost", "this computer"],
    ["pypi.org:0", "port that does not exist"],
    ["pypi.org:70000", "port that does not exist"],
    ["exa mple.com", "without a scheme or path"],
    ["-bad-.com", "is not a host"],
  ])("refuses %s, saying why", (host, why) => {
    expect(hostListProblem([host])).toContain(why);
  });

  it("refuses a host that is not text", () => {
    expect(hostListProblem([42])).toBe(
      "Name each host as text, such as pypi.org.",
    );
  });
});
