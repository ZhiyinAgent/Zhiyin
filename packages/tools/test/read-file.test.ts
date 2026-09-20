import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceTools } from "../src/index.js";

async function workspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "zhiyin-read-"));
}

describe("reading a file", () => {
  it("keeps both ends of a very long file and says what it left out", async () => {
    const root = await workspace();
    const lines = Array.from(
      { length: 40_000 },
      (_, index) => `line ${index}: the quick brown fox`,
    );
    await writeFile(join(root, "log.txt"), lines.join("\n"), "utf8");
    const tools = new WorkspaceTools(root);

    const result = await tools.execute("read_file", { path: "log.txt" });

    if (!result.ok) throw new Error(result.reason);
    const { text } = result.value as { text: string };
    // The beginning and the end both survive: a log's last line is often the
    // one that matters, and a head-only cut throws it away.
    expect(text).toContain("line 0:");
    expect(text).toContain("line 39999:");
    expect(text).toContain("left out");
    expect(text.length).toBeLessThan(lines.join("\n").length / 2);
  });

  it("leaves a file that fits exactly as it is", async () => {
    const root = await workspace();
    await writeFile(join(root, "note.md"), "Short and whole.", "utf8");
    const tools = new WorkspaceTools(root);

    const result = await tools.execute("read_file", { path: "note.md" });

    expect(result).toMatchObject({
      ok: true,
      value: { text: "Short and whole." },
    });
  });

  it("refuses a file that is not text, and says what it is instead", async () => {
    const root = await workspace();
    // A PNG header, then bytes no text file would contain.
    await writeFile(
      join(root, "shot.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1]),
    );
    await writeFile(
      join(root, "app.bin"),
      Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff, 0xfe, 0x00, 0x03]),
    );
    const tools = new WorkspaceTools(root);

    const picture = await tools.execute("read_file", { path: "shot.png" });
    const binary = await tools.execute("read_file", { path: "app.bin" });

    // A picture is not unreadable, it is read by something else.
    expect(picture).toMatchObject({ ok: false });
    if (picture.ok) throw new Error("A picture is not text");
    expect(picture.reason).toContain("read_image");
    expect(binary).toMatchObject({ ok: false });
    if (binary.ok) throw new Error("A binary is not text");
    expect(binary.reason).toMatch(/not a text file/i);
  });

  it("reads a text file that merely contains unusual characters", async () => {
    const root = await workspace();
    await writeFile(join(root, "notes.md"), "Grüße — ok\ttabbed\r\n", "utf8");
    const tools = new WorkspaceTools(root);

    const result = await tools.execute("read_file", { path: "notes.md" });

    expect(result).toMatchObject({ ok: true });
  });
});

describe("a call the model got wrong in shape", () => {
  it("is answered to the model rather than shown as a failed action", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root);

    // A malformed call is a fact about the request, not about authority: the
    // model can fix it, and a person watching learns nothing from being told.
    // Leaving the workspace is never correctable, however it arose.
    expect(await tools.inspect("list_directory", {})).toMatchObject({
      ok: false,
      correctable: true,
    });
    expect(await tools.inspect("read_file", {})).toMatchObject({
      ok: false,
      correctable: true,
    });
    expect(await tools.inspect("write_file", { path: "a.txt" })).toMatchObject({
      ok: false,
      correctable: true,
    });
    const outside = await tools.inspect("write_file", {
      path: "../outside.txt",
      text: "x",
    });
    expect(outside.ok).toBe(false);
    expect((outside as { correctable?: boolean }).correctable).not.toBe(true);
  });
});
