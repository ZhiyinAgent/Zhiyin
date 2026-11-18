import { describe, expect, it } from "vitest";
import { namedWorkspaceFiles } from "../src/index.js";

describe("files a call names in the workspace", () => {
  it("are read by their path from the workspace, with forward slashes, each once", () => {
    expect(
      namedWorkspaceFiles(["data\\big.parquet", "./data/big.parquet"]),
    ).toEqual({ ok: true, paths: ["data/big.parquet"] });
  });

  it("are none when none are named", () => {
    expect(namedWorkspaceFiles(undefined)).toEqual({ ok: true, paths: [] });
  });

  it("are refused when one leaves the workspace or is a whole path", () => {
    for (const path of ["../outside.txt", "C:\\Users\\x.txt", "/etc/x", ""])
      expect(namedWorkspaceFiles([path])).toMatchObject({ ok: false });
  });

  it("are refused when one is in Git's folder", () => {
    expect(namedWorkspaceFiles([".git/config"])).toEqual({
      ok: false,
      reason: ".git/config is in Git's folder, which a script may not change.",
    });
  });

  it("are refused when they are not a list of paths", () => {
    expect(namedWorkspaceFiles("data/big.parquet")).toMatchObject({
      ok: false,
    });
  });
});

describe("files a call names in the folders outside the workspace it is given", () => {
  const elsewhere = "C:\\Data\\Exports";

  it("are read by their whole path inside one of those folders", () => {
    expect(
      namedWorkspaceFiles(
        ["C:\\Data\\Exports\\big.parquet", "data/table.csv"],
        [elsewhere],
      ),
    ).toEqual({
      ok: true,
      paths: ["C:\\Data\\Exports\\big.parquet", "data/table.csv"],
    });
  });

  it("are refused when a whole path is in none of those folders, or is one of them", () => {
    for (const path of ["C:\\Data\\other.bin", "C:\\Data\\Exports"])
      expect(namedWorkspaceFiles([path], [elsewhere])).toMatchObject({
        ok: false,
      });
  });

  it("are refused when one is in a Git folder there", () => {
    expect(
      namedWorkspaceFiles(["C:\\Data\\Exports\\.git\\config"], [elsewhere]),
    ).toMatchObject({ ok: false, reason: expect.stringContaining("Git") });
  });

  it("are refused when a whole path steps out of the folder", () => {
    expect(
      namedWorkspaceFiles(["C:\\Data\\Exports\\..\\secret.txt"], [elsewhere]),
    ).toMatchObject({ ok: false });
  });
});
