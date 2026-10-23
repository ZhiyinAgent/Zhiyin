import { copyFile, mkdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { estimatedTokens, type FileRead } from "@zhiyin/contract";
import { ansiCodePage, ansiText } from "@zhiyin/process-ownership";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import {
  WorkspaceTools,
  type ConversationItems,
  type ToolResult,
} from "../src/index.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

async function workspace(): Promise<string> {
  return folders.make("zhiyin-read-");
}

function numberedLines(count: number): string {
  return Array.from(
    { length: count },
    (_, index) => `line ${index + 1}: the quick brown fox`,
  ).join("\n");
}

/**
 * A line that is not UTF-8 as Windows reads text naming no encoding, or as
 * Windows-1252 on a PC whose own code page is UTF-8.
 */
function asWindowsReads(bytes: Buffer): string {
  return (
    (ansiCodePage() === 65001 ? undefined : ansiText(bytes)) ??
    new TextDecoder("windows-1252").decode(bytes)
  );
}

function textOf(result: ToolResult): string {
  if (!result.ok) throw new Error(result.reason);
  return (result.value as { text: string }).text;
}

describe("reading a file", () => {
  it("reads a short file whole, each line numbered", async () => {
    const root = await workspace();
    await writeFile(join(root, "note.md"), "Short and whole.\nSecond.", "utf8");
    const tools = new WorkspaceTools(root);

    const result = await tools.execute("read_file", { path: "note.md" });

    expect(result).toMatchObject({
      ok: true,
      value: { text: "1→Short and whole.\n2→Second.", totalLines: 2 },
    });
  });

  it("reads line 9,000 of a 20,000-line file", async () => {
    const root = await workspace();
    await writeFile(join(root, "log.txt"), numberedLines(20_000), "utf8");
    const tools = new WorkspaceTools(root);

    const result = await tools.execute("read_file", {
      path: "log.txt",
      startLine: 9_000,
      lineCount: 1,
    });

    expect(textOf(result).split("\n")[0]).toBe(
      "9000→line 9000: the quick brown fox",
    );
    expect(textOf(result)).toContain(
      "lines 9001–20,000 not shown; call read_file with startLine=9001",
    );
  });

  it("reads a long file a page at a time, and says where the next page starts", async () => {
    const root = await workspace();
    // Lines short enough that 2,000 of them fit the token limit.
    await writeFile(
      join(root, "log.txt"),
      Array.from({ length: 20_000 }, () => "x").join("\n"),
      "utf8",
    );
    const tools = new WorkspaceTools(root);

    const text = textOf(await tools.execute("read_file", { path: "log.txt" }));

    const shown = text.split("\n").filter((line) => /^\d+→/.test(line));
    expect(shown[0]).toBe("1→x");
    expect(shown).toHaveLength(2_000);
    expect(
      text.endsWith(
        "… lines 2001–20,000 not shown; call read_file with startLine=2001",
      ),
    ).toBe(true);
  });

  it.each([
    ["Chinese", "测试中文内容的阅读限制"],
    ["English", "reading limits in English"],
  ])(
    "returns at most the token limit per read of a 60,000-character %s file",
    async (_, phrase) => {
      const root = await workspace();
      const line = phrase.repeat(Math.ceil(100 / phrase.length)).slice(0, 100);
      await writeFile(
        join(root, "doc.txt"),
        Array.from({ length: 600 }, () => line).join("\n"),
        "utf8",
      );
      const tools = new WorkspaceTools(root);

      const text = textOf(
        await tools.execute("read_file", { path: "doc.txt" }),
      );

      expect(estimatedTokens(text)).toBeLessThanOrEqual(8_000);
      expect(text).toContain("not shown; call read_file with startLine=");
    },
  );

  it("returns a page as large as the answer the model is shown, when told it", async () => {
    const root = await workspace();
    const line = "reading limits in English ".repeat(4).slice(0, 100);
    await writeFile(
      join(root, "doc.txt"),
      Array.from({ length: 1_500 }, () => line).join("\n"),
      "utf8",
    );
    const tools = new WorkspaceTools(root);

    const text = textOf(
      await tools.execute(
        "read_file",
        { path: "doc.txt" },
        undefined,
        undefined,
        25_000,
      ),
    );

    expect(estimatedTokens(text)).toBeGreaterThan(24_000);
    expect(estimatedTokens(text)).toBeLessThanOrEqual(25_000);
    expect(text).toContain("not shown; call read_file with startLine=");
  });

  it("fits a page to the answer as it is sent, where quotes and line breaks are written out", async () => {
    const root = await workspace();
    const code = `const value = "reading limits"; // short code line`;
    await writeFile(
      join(root, "code.ts"),
      Array.from({ length: 5_000 }, () => code).join("\n"),
      "utf8",
    );
    const tools = new WorkspaceTools(root);

    for (const answerTokens of [8_000, 25_000]) {
      const result = await tools.execute(
        "read_file",
        { path: "code.ts" },
        undefined,
        undefined,
        answerTokens,
      );
      // The model is sent the answer without the person's copy of it.
      const sent = JSON.stringify({ ...result, details: undefined });
      expect(estimatedTokens(sent)).toBeLessThanOrEqual(answerTokens);
      expect(estimatedTokens(sent)).toBeGreaterThan(answerTokens * 0.95);
    }
  });

  it("never splits a character in two, even on a page with room for one", async () => {
    const root = await workspace();
    await writeFile(join(root, "faces.txt"), "😀".repeat(40), "utf8");
    const tools = new WorkspaceTools(root);
    // The smallest answer that shows any of the line holds one character.
    let least = 1;
    while (
      !(
        await tools.execute(
          "read_file",
          { path: "faces.txt" },
          undefined,
          undefined,
          least,
        )
      ).ok
    )
      least += 1;

    for (let answerTokens = least; answerTokens < least + 6; answerTokens++) {
      let shown = "";
      let from = 1;
      for (let page = 0; page < 90 && from <= 80; page += 1) {
        const result = await tools.execute(
          "read_file",
          { path: "faces.txt", startCharacter: from },
          undefined,
          undefined,
          answerTokens,
        );
        const text = textOf(result);
        expect(text).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
        expect(text).not.toMatch(/(?<![\ud800-\udbff])[\udc00-\udfff]/);
        shown += /1→(\S*)/.exec(text)?.[1] ?? "";
        const next = /startCharacter=(\d+)/.exec(text)?.[1];
        if (!next) break;
        from = Number(next);
      }

      expect(shown).toBe("😀".repeat(40));
    }
  });

  it("leaves room in a page for a long path written out, in any script", async () => {
    const root = await workspace();
    const parts = [
      "季度报告资料汇总与分析文件夹第一部分内容和附录材料整理",
      "季度报告资料汇总与分析文件夹第二部分内容和附录材料整理",
      "季度报告资料汇总与分析文件夹第三部分内容和附录材料整理",
    ];
    const folder = join(root, ...parts);
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, "季度报告最终版本说明文档.txt"),
      Array.from(
        { length: 5_000 },
        (_, line) => `第${line + 1}行 "quoted"`,
      ).join("\n"),
      "utf8",
    );
    const tools = new WorkspaceTools(root);

    for (const answerTokens of [1_600, 5_280, 8_000]) {
      const result = await tools.execute(
        "read_file",
        { path: [...parts, "季度报告最终版本说明文档.txt"].join("/") },
        undefined,
        undefined,
        answerTokens,
      );
      const sent = JSON.stringify({ ...result, details: undefined });
      expect(estimatedTokens(sent)).toBeLessThanOrEqual(answerTokens);
      expect(estimatedTokens(sent)).toBeGreaterThan(answerTokens * 0.9);
    }
  });

  it("shows a long line whole when it fits the page", async () => {
    const root = await workspace();
    const long = `a${"x".repeat(9_998)}z`;
    await writeFile(join(root, "min.js"), `${long}\nnext`, "utf8");
    const tools = new WorkspaceTools(root);

    const text = textOf(await tools.execute("read_file", { path: "min.js" }));

    expect(text).toBe(`1→${long}\n2→next`);
  });

  it("reads a line longer than a page in parts, each saying where the next starts", async () => {
    const root = await workspace();
    const long = Array.from({ length: 10_000 }, (_, index) =>
      String(index % 10),
    )
      .join("")
      .repeat(10);
    await writeFile(join(root, "data.json"), `{\n${long}\n}\n`, "utf8");
    const tools = new WorkspaceTools(root);

    const first = textOf(
      await tools.execute("read_file", { path: "data.json" }),
    );
    // The page stops before a line it cannot hold whole.
    expect(first).toBe(
      "1→{\n… lines 2–3 not shown; call read_file with startLine=2",
    );
    let shown = "";
    let next: number | undefined = 1;
    while (next !== undefined) {
      const page = textOf(
        await tools.execute("read_file", {
          path: "data.json",
          startLine: 2,
          ...(next > 1 ? { startCharacter: next } : {}),
        }),
      );
      const [, part = ""] = /^(?:[^\n]*\n)?2→(\d*)/.exec(page) ?? [];
      shown += part;
      const more =
        /line 2 continues at character ([\d,]+) of 100,000; call read_file with startLine=2 and startCharacter=(\d+)/.exec(
          page,
        );
      next = more ? Number(more[2]) : undefined;
      if (!more) expect(page).toContain("3→}");
    }
    expect(shown).toBe(long);
  });

  it("reads a line of pictographs in parts, never splitting one", async () => {
    const root = await workspace();
    const line = `x${"😀".repeat(30_000)}`;
    await writeFile(join(root, "faces.txt"), `${line}\n`, "utf8");
    const tools = new WorkspaceTools(root);

    const parts: string[] = [];
    let next: number | undefined = 1;
    while (next !== undefined) {
      const page = textOf(
        await tools.execute("read_file", {
          path: "faces.txt",
          ...(next > 1 ? { startCharacter: next } : {}),
        }),
      );
      const [, part = ""] = /^(?:[^\n]*\n)?1→([^\n]*)/.exec(page) ?? [];
      parts.push(part);
      const more = /startCharacter=(\d+)/.exec(page);
      next = more ? Number(more[1]) : undefined;
    }

    expect(parts.length).toBeGreaterThan(2);
    for (const part of parts)
      expect(part).not.toMatch(/^[\udc00-\udfff]|[\ud800-\udbff]$/);
    expect(parts.join("")).toBe(line);
  });

  it("starts at the next whole character when asked to start inside one", async () => {
    const root = await workspace();
    await writeFile(join(root, "faces.txt"), "😀😀😀\n", "utf8");
    const tools = new WorkspaceTools(root);

    const page = textOf(
      await tools.execute("read_file", {
        path: "faces.txt",
        startCharacter: 2,
      }),
    );

    expect(page).toContain("Line 1 from character 3:\n1→😀😀");
    expect(page).not.toMatch(/(?<![\ud800-\udbff])[\udc00-\udfff]/);
  });

  it("says how long a line is when asked for a character past its end", async () => {
    const root = await workspace();
    await writeFile(join(root, "hello.txt"), "hello\nworld\n");
    await writeFile(join(root, "gap.txt"), "a\n\nb");
    await writeFile(
      join(root, "cut.txt"),
      Buffer.concat([
        Buffer.from("caf", "latin1"),
        Buffer.from([0xe9]),
        Buffer.from(`\n${"A".repeat(1_100_000)}\nend\n`, "latin1"),
      ]),
    );
    const tools = new WorkspaceTools(root);
    const refusal = async (input: Record<string, unknown>) => {
      const result = await tools.execute("read_file", input);
      if (result.ok) throw new Error("A character past the line is refused");
      return result.reason;
    };

    expect(await refusal({ path: "hello.txt", startCharacter: 7 })).toContain(
      "has 5 characters, so there is no character 7.",
    );
    expect(
      await refusal({ path: "gap.txt", startLine: 2, startCharacter: 2 }),
    ).toContain("has 0 characters, so there is no character 2.");
    const cut = await refusal({
      path: "cut.txt",
      startLine: 2,
      startCharacter: 1_050_000,
    });
    expect(cut).toContain("first MiB");
    expect(cut).toContain("1,048,576 characters");
  });

  it("says the rest of a line past its first MiB is not shown, and names the next line", async () => {
    const root = await workspace();
    await writeFile(
      join(root, "cut.txt"),
      Buffer.concat([
        Buffer.from("caf", "latin1"),
        Buffer.from([0xe9]),
        Buffer.from(`\n${"A".repeat(1_100_000)}\nend\n`, "latin1"),
      ]),
    );
    const tools = new WorkspaceTools(root);

    const page = textOf(
      await tools.execute("read_file", {
        path: "cut.txt",
        startLine: 2,
        startCharacter: 1_048_000,
      }),
    );

    expect(page).toContain(
      "the rest of line 2 is not shown: in a file that is not UTF-8, a line is read up to its first MiB.",
    );
    expect(page).toContain("call read_file with startLine=3");
  });

  it("reads a text file larger than 2 MB, a page at a time", async () => {
    const root = await workspace();
    await writeFile(join(root, "big.log"), numberedLines(120_000), "utf8");
    const tools = new WorkspaceTools(root);

    const text = textOf(
      await tools.execute("read_file", {
        path: "big.log",
        startLine: 119_999,
      }),
    );

    expect(text).toBe(
      "119999→line 119999: the quick brown fox\n120000→line 120000: the quick brown fox",
    );
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
    expect(picture.reason).toContain("read_document");
    expect(binary).toMatchObject({ ok: false });
    if (binary.ok) throw new Error("A binary is not text");
    expect(binary.reason).toMatch(/not a text file/i);
  });

  it("keeps the UTF-8 lines of a file that is not all UTF-8, however late its first stray byte", async () => {
    const root = await workspace();
    await writeFile(
      join(root, "mixed.txt"),
      Buffer.concat([
        Buffer.from("第一行\ncafé\n", "utf8"),
        // One byte that UTF-8 cannot read, as Windows-1252 writes é.
        Buffer.from("naïve\n", "latin1"),
        Buffer.from("最后一行\n", "utf8"),
      ]),
    );
    const tools = new WorkspaceTools(root);

    const text = textOf(
      await tools.execute("read_file", { path: "mixed.txt" }),
    );

    expect(text).toContain("1→第一行");
    expect(text).toContain("2→café");
    expect(text).toContain(
      `3→${asWindowsReads(Buffer.from("naïve", "latin1"))}`,
    );
    expect(text).toContain("4→最后一行");
    expect(text).toMatch(/line 3 is the first that is not/);
  });

  it("reads a file that is not all UTF-8 line by line when its lines end in a carriage return alone", async () => {
    const root = await workspace();
    await writeFile(
      join(root, "classic.txt"),
      Buffer.concat([
        Buffer.from("第一行\r", "utf8"),
        Buffer.from("café\r", "latin1"),
        Buffer.from("最后一行\r", "utf8"),
      ]),
    );
    const tools = new WorkspaceTools(root);

    const text = textOf(
      await tools.execute("read_file", { path: "classic.txt" }),
    );

    expect(text).toContain("1→第一行");
    expect(text).toContain(
      `2→${asWindowsReads(Buffer.from("café", "latin1"))}`,
    );
    expect(text).toContain("3→最后一行");
    expect(text).toMatch(/line 2 is the first that is not/);
  });

  it("counts a carriage return and line feed together as one line break", async () => {
    const root = await workspace();
    await writeFile(
      join(root, "windows.txt"),
      Buffer.concat([
        Buffer.from("one\r\ntwo\r\n", "utf8"),
        Buffer.from("café\r\n", "latin1"),
      ]),
    );
    const tools = new WorkspaceTools(root);

    const text = textOf(
      await tools.execute("read_file", { path: "windows.txt" }),
    );

    expect(text).toMatch(/line 3 is the first that is not/);
    expect(text).toContain(
      `3→${asWindowsReads(Buffer.from("café", "latin1"))}`,
    );
  });

  it("keeps the last line of a file that is not all UTF-8 and does not end in a line break", async () => {
    const root = await workspace();
    await writeFile(
      join(root, "unended.txt"),
      Buffer.concat([
        Buffer.from("café\n", "latin1"),
        Buffer.from("最后一行", "utf8"),
      ]),
    );
    const tools = new WorkspaceTools(root);

    const text = textOf(
      await tools.execute("read_file", { path: "unended.txt" }),
    );

    expect(text).toContain("2→最后一行");
  });

  it("keeps a long UTF-8 line UTF-8 in a file that is not all UTF-8, never splitting a character", async () => {
    const root = await workspace();
    await writeFile(
      join(root, "long.txt"),
      Buffer.concat([
        Buffer.from("café!\n", "latin1"),
        // More than a megabyte on one line, each character three bytes, so
        // a line read in pieces would split one.
        Buffer.from(`${"中".repeat(400_000)}\n`, "utf8"),
      ]),
    );
    const tools = new WorkspaceTools(root);

    const text = textOf(
      await tools.execute("read_file", { path: "long.txt", startLine: 2 }),
    );

    const [, shown = ""] = /\n2→([^\n]*)\n/.exec(text) ?? [];
    expect(shown.length).toBeGreaterThan(1_000);
    expect(shown).toBe("中".repeat(shown.length));
    expect(text).toContain(
      `line 2 continues at character ${(shown.length + 1).toLocaleString("en-US")}`,
    );
  });

  it("reads text that is not UTF-8 in this PC's own code page, and says so with the first line that is not", async () => {
    const root = await workspace();
    // "café" and "naïve" as Windows-1252 writes them: é is E9, ï is EF.
    await writeFile(
      join(root, "legacy.txt"),
      Buffer.concat([
        Buffer.from("plain\n", "latin1"),
        Buffer.from("café\nnaïve\n", "latin1"),
      ]),
    );
    const tools = new WorkspaceTools(root);

    const text = textOf(
      await tools.execute("read_file", { path: "legacy.txt" }),
    );

    expect(text).toContain("1→plain");
    // As Windows reads text that names no encoding: café on most Western PCs.
    expect(text).toContain(
      `2→${asWindowsReads(Buffer.from("café", "latin1"))}`,
    );
    expect(text).toContain(
      `3→${asWindowsReads(Buffer.from("naïve", "latin1"))}`,
    );
    expect(text).toMatch(/not all UTF-8/);
    expect(text).toMatch(/line 2/);
    expect(text).toContain(
      ansiCodePage() === 65001
        ? "as Windows-1252"
        : `code page ${ansiCodePage()}`,
    );
    expect(text).toMatch(/multi_edit/);
  });

  it("finds text that is not UTF-8 however far into the file it starts", async () => {
    const root = await workspace();
    await writeFile(
      join(root, "long.txt"),
      Buffer.concat([
        Buffer.from(`${numberedLines(3_000)}\n`, "utf8"),
        Buffer.from("café\n", "latin1"),
      ]),
    );
    const tools = new WorkspaceTools(root);

    const text = textOf(await tools.execute("read_file", { path: "long.txt" }));

    expect(text).toMatch(/line 3,001/);
    expect(text).toContain("1→line 1: the quick brown fox");
  });

  it.each([
    ["little-endian", "utf16le" as const, [0xff, 0xfe]],
    ["big-endian", "utf16be" as const, [0xfe, 0xff]],
  ])(
    "reads UTF-16 text (%s, with its byte-order mark) as text, and names it",
    async (_order, encoding, mark) => {
      const root = await workspace();
      const little = Buffer.from("Hello\r\nWörld\r\n", "utf16le");
      const bytes = encoding === "utf16le" ? little : little.swap16();
      await writeFile(
        join(root, "out.txt"),
        Buffer.concat([Buffer.from(mark), bytes]),
      );
      const tools = new WorkspaceTools(root);

      const text = textOf(
        await tools.execute("read_file", { path: "out.txt" }),
      );

      expect(text).toContain("1→Hello");
      expect(text).toContain("2→Wörld");
      expect(text).toMatch(/UTF-16/);
    },
  );

  it("still refuses a binary file that happens to begin like UTF-16", async () => {
    const root = await workspace();
    await writeFile(
      join(root, "data.bin"),
      Buffer.from([0xff, 0xfe, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x04, 0x00]),
    );
    const tools = new WorkspaceTools(root);

    const result = await tools.execute("read_file", { path: "data.bin" });

    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("A binary is not text");
    expect(result.reason).toMatch(/not a text file/i);
  });

  it("reads text that begins with the letters of a picture's or a program's signature", async () => {
    const root = await workspace();
    await writeFile(join(root, "cars.csv"), "BMW,320i,2019\nAudi,A4,2020\n");
    await writeFile(join(root, "parts.txt"), "MZ-1200 bracket\n");
    await writeFile(join(root, "howto.txt"), "Convert WEBP to PNG\n");
    const tools = new WorkspaceTools(root);

    expect(
      textOf(await tools.execute("read_file", { path: "cars.csv" })),
    ).toContain("BMW,320i,2019");
    expect(
      textOf(await tools.execute("read_file", { path: "parts.txt" })),
    ).toContain("MZ-1200 bracket");
    expect(
      textOf(await tools.execute("read_file", { path: "howto.txt" })),
    ).toContain("Convert WEBP to PNG");
  });

  it("reads a text file that merely contains unusual characters", async () => {
    const root = await workspace();
    await writeFile(join(root, "notes.md"), "Grüße — ok\ttabbed\r\n", "utf8");
    const tools = new WorkspaceTools(root);

    const result = await tools.execute("read_file", { path: "notes.md" });

    expect(result).toMatchObject({ ok: true });
  });
});

describe("a file made of one very long line", () => {
  it("is read without holding the line in memory", async () => {
    const root = await workspace();
    const path = join(root, "dump.json");
    await writeFile(path, "x".repeat(64 * 1024 * 1024));
    const tools = new WorkspaceTools(root);
    const before = process.memoryUsage().heapUsed;
    let most = before;
    const watch = setInterval(() => {
      most = Math.max(most, process.memoryUsage().heapUsed);
    }, 2);

    const text = textOf(
      await tools.execute("read_file", { path: "dump.json" }),
    );

    clearInterval(watch);
    most = Math.max(most, process.memoryUsage().heapUsed);
    expect(text).toMatch(/^1→x+\n… line 1 continues at character/);
    expect(most - before).toBeLessThan(32 * 1024 * 1024);
  }, 60_000);
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
      content: "x",
    });
    expect(outside.ok).toBe(false);
    expect((outside as { correctable?: boolean }).correctable).not.toBe(true);
  });
});

/** What the application keeps for each conversation, held in memory. */
function keptItems(root: string) {
  const items = new Map<string, string>();
  const reads = new Map<string, FileRead>();
  const port: ConversationItems = {
    locate: async (conversationId, kind, id) => {
      const path = items.get(`${conversationId}/${kind}/${id}`);
      return path
        ? { status: "ready", path }
        : { status: "missing", reason: "This output is no longer stored." };
    },
    keepOutput: async (conversationId, file) => {
      const id = `out-${items.size + 1}`;
      const path = join(root, `${id}.txt`);
      await copyFile(file, path);
      items.set(`${conversationId}/output/${id}`, path);
      return { status: "kept", id };
    },
    lastRead: async (conversationId, path) =>
      reads.get(`${conversationId}/${path}`),
    noteRead: async (conversationId, path, read) => {
      reads.set(`${conversationId}/${path}`, read);
    },
  };
  return {
    port,
    async put(
      conversationId: string,
      kind: "output" | "attachment",
      id: string,
      text: string,
    ) {
      const path = join(root, `${kind}-${id}`);
      await writeFile(path, text, "utf8");
      items.set(`${conversationId}/${kind}/${id}`, path);
    },
  };
}

describe("reading what a conversation kept", () => {
  it("reads a saved output by its id, a page at a time, within its own conversation only", async () => {
    const root = await workspace();
    const kept = keptItems(await workspace());
    await kept.put("task-1", "output", "abc", numberedLines(5_000));
    const tools = new WorkspaceTools(root, { items: kept.port });

    const page = await tools.execute(
      "read_file",
      { path: "output://abc", startLine: 2_500, lineCount: 2 },
      undefined,
      "task-1",
    );
    const elsewhere = await tools.execute(
      "read_file",
      { path: "output://abc" },
      undefined,
      "task-2",
    );

    expect(textOf(page).split("\n").slice(0, 2)).toEqual([
      "2500→line 2500: the quick brown fox",
      "2501→line 2501: the quick brown fox",
    ]);
    expect(elsewhere).toEqual({
      ok: false,
      reason: "This output is no longer stored.",
    });
  });

  it("reads a pasted text by its attachment id, without asking", async () => {
    const root = await workspace();
    const kept = keptItems(await workspace());
    await kept.put("task-1", "attachment", "pasted-1.txt", "The pasted log.");
    const tools = new WorkspaceTools(root, { items: kept.port });

    expect(
      await tools.inspect("read_file", { path: "attachment://pasted-1.txt" }),
    ).toMatchObject({ scope: "workspace", access: "read" });
    expect(
      textOf(
        await tools.execute(
          "read_file",
          { path: "attachment://pasted-1.txt" },
          undefined,
          "task-1",
        ),
      ),
    ).toBe("1→The pasted log.");
  });

  it("says a file changed since the last read, and still reads it", async () => {
    const root = await workspace();
    await writeFile(join(root, "log.txt"), numberedLines(3_000), "utf8");
    const tools = new WorkspaceTools(root, {
      items: keptItems(await workspace()).port,
    });
    const first = await tools.execute(
      "read_file",
      { path: "log.txt" },
      undefined,
      "task-1",
    );
    await writeFile(join(root, "log.txt"), numberedLines(3_100), "utf8");
    const later = new Date(Date.now() + 60_000);
    await utimes(join(root, "log.txt"), later, later);

    const second = await tools.execute(
      "read_file",
      { path: "log.txt", startLine: 2_001 },
      undefined,
      "task-1",
    );
    const unchanged = await tools.execute(
      "read_file",
      { path: "log.txt", startLine: 3_001 },
      undefined,
      "task-1",
    );

    expect(textOf(first)).not.toContain("changed since your last read");
    expect(textOf(second)).toMatch(
      /^This file changed since your last read at .+; earlier pages may be out of date\.\n2001→line 2001/,
    );
    expect(textOf(unchanged)).not.toContain("changed since your last read");
  });
});

describe("a conversation without a folder", () => {
  it("can read what it kept, and nothing from a folder", async () => {
    const kept = keptItems(await workspace());
    await kept.put("task-1", "attachment", "pasted-1.txt", "The pasted log.");
    const tools = new WorkspaceTools(undefined, {
      shell: undefined,
      items: kept.port,
    });

    expect(tools.list().map((tool) => tool.name)).toContain("read_file");
    expect(tools.list().map((tool) => tool.name)).not.toContain(
      "list_directory",
    );
    expect(
      textOf(
        await tools.execute(
          "read_file",
          { path: "attachment://pasted-1.txt" },
          undefined,
          "task-1",
        ),
      ),
    ).toBe("1→The pasted log.");
    expect(
      await tools.execute(
        "read_file",
        { path: "notes.md" },
        undefined,
        "task-1",
      ),
    ).toEqual({ ok: false, reason: "Choose a folder before using files." });
  });
});
