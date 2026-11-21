/**
 * What a request for more names, as Zhiyin checks it before any card (ADR
 * 0029): a website by its registrable domain under the Public Suffix List,
 * or one exact host; a folder by its whole real path; and what is never
 * granted refused with the reason.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, symlink, writeFile, link } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { checkedFolder, checkedWebsite } from "../src/commands/reach.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

describe("a website asked for", () => {
  it("is granted by its registrable domain, which covers every name below it", () => {
    expect(checkedWebsite("api.data.example.co.uk", false, undefined)).toEqual({
      ok: true,
      site: "example.co.uk",
      hosts: ["example.co.uk", "*.example.co.uk"],
      label: "example.co.uk and every name below it",
    });
  });

  it("is granted as one exact host when asked, on another port when named", () => {
    expect(checkedWebsite("API.Example.com.", true, 8443)).toEqual({
      ok: true,
      site: "api.example.com",
      hosts: ["api.example.com:8443"],
      label: "api.example.com only, on port 8443",
    });
  });

  it("keeps a name under a suffix where anyone can have one apart from its neighbours", () => {
    expect(
      checkedWebsite("docs.alice.github.io", false, undefined),
    ).toMatchObject({
      ok: true,
      hosts: ["alice.github.io", "*.alice.github.io"],
    });
  });

  it.each([
    ["github.io", "public suffix"],
    ["co.uk", "public suffix"],
    ["127.0.0.1", "address"],
    ["[::1]", "not a host"],
    ["localhost", "this computer"],
    ["printer.local", "this computer"],
    ["https://example.com/path", "not a host"],
    ["*.example.com", "not a host"],
    ["example.com:8080", "not a host"],
    ["my-bucket.s3.amazonaws.com", "many unrelated people"],
    ["d111111abcdef8.cloudfront.net", "many unrelated people"],
  ])("refuses %s before any card", (host, why) => {
    const checked = checkedWebsite(host, false, undefined);

    expect(checked.ok).toBe(false);
    expect(checked.ok ? "" : checked.reason).toContain(why);
  });

  it("writes an international name as the proxy sees it", () => {
    expect(checkedWebsite("bücher.example", true, undefined)).toMatchObject({
      ok: true,
      hosts: ["xn--bcher-kva.example"],
    });
  });
});

describe("a folder asked for", () => {
  it("is granted by its whole real path", async () => {
    const folder = await folders.make("zhiyin-request-folder-");
    await writeFile(join(folder, "data.csv"), "a,b\n");

    expect(await checkedFolder(folder, "read", [], undefined)).toEqual({
      ok: true,
      folder,
    });
  });

  it("is refused when named through a link, naming where it leads", async () => {
    const real = await folders.make("zhiyin-request-real-");
    const linked = join(await folders.make("zhiyin-request-links-"), "there");
    await symlink(real, linked, "junction");

    const checked = await checkedFolder(linked, "read", [], undefined);

    expect(checked).toEqual({
      ok: false,
      reason: expect.stringContaining(`name the folder it leads to, ${real}`),
    });
  });

  it("is refused when it holds a link leading out of it", async () => {
    const folder = await folders.make("zhiyin-request-holds-link-");
    const elsewhere = await folders.make("zhiyin-request-elsewhere-");
    await symlink(elsewhere, join(folder, "out"), "junction");

    expect(await checkedFolder(folder, "read", [], undefined)).toEqual({
      ok: false,
      reason: expect.stringContaining("holds a link leading out of it"),
    });
  });

  it("is refused when a file in it has another name, which could be outside it", async () => {
    const folder = await folders.make("zhiyin-request-hard-link-");
    const elsewhere = await folders.make("zhiyin-request-other-name-");
    await writeFile(join(elsewhere, "secret.txt"), "x");
    await link(join(elsewhere, "secret.txt"), join(folder, "secret.txt"));

    expect(await checkedFolder(folder, "read", [], undefined)).toEqual({
      ok: false,
      reason: expect.stringContaining("more than one name"),
    });
  });

  it("is refused when it is the workspace, holds it, or is Zhiyin's own", async () => {
    const parent = await folders.make("zhiyin-request-parent-");
    const workspace = join(parent, "work");
    const own = join(parent, "zhiyin-data");
    await mkdir(workspace);
    await mkdir(own);

    expect(await checkedFolder(workspace, "read", [], workspace)).toMatchObject(
      {
        ok: false,
        reason: expect.stringContaining("is in the workspace"),
      },
    );
    expect(await checkedFolder(parent, "read", [], workspace)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("holds the workspace"),
    });
    expect(await checkedFolder(own, "read", [own], undefined)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("Zhiyin keeps for itself"),
    });
  });

  it("is refused when it is a drive, the user folder, or a folder holding them", async () => {
    for (const folder of ["C:\\", homedir()])
      expect(await checkedFolder(folder, "read", [], undefined)).toMatchObject({
        ok: false,
        reason: expect.stringContaining("holds nearly everything"),
      });
  });

  it("is refused where credentials are kept", async () => {
    const ssh = join(homedir(), ".ssh");
    const checked = await checkedFolder(ssh, "read", [], undefined);

    // A computer without one refuses it as not there.
    expect(checked).toMatchObject({
      ok: false,
      reason: expect.stringContaining(
        existsSync(ssh)
          ? "where credentials are kept"
          : "not a folder that is there",
      ),
    });
  });

  it("may be read but never changed in Windows' own folders and Program Files", async () => {
    const windows = process.env["SystemRoot"] ?? "C:\\Windows";
    const fonts = join(windows, "Fonts");

    expect(await checkedFolder(fonts, "change", [], undefined)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("may read but never change"),
    });
  });

  it("is refused when only an administrator may change who opens it, pointing to full access, unless Zhiyin runs as one", async () => {
    const common = join(
      process.env["ProgramFiles"] ?? "C:\\Program Files",
      "Common Files",
    );
    // `net session` answers only an elevated administrator.
    const elevated =
      spawnSync("net", ["session"], { stdio: "ignore" }).status === 0;

    const checked = await checkedFolder(common, "read", [], undefined);

    if (elevated)
      expect(checked.ok ? "" : checked.reason).not.toContain("administrator");
    else
      expect(checked).toMatchObject({
        ok: false,
        reason: expect.stringMatching(
          /only an administrator may change who opens it.*full_access/,
        ),
      });
  });

  it("is refused when named from no drive", async () => {
    expect(await checkedFolder("data", "read", [], undefined)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("not a whole path"),
    });
  });
});
