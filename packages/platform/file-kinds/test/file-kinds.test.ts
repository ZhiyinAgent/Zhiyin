import { describe, expect, it } from "vitest";
import { fileKind } from "../src/index.js";

const text = (value: string) => Buffer.from(value, "latin1");

/** A bitmap's header: its reserved bytes 6 to 9 are zero. */
function bitmap(): Buffer {
  const bytes = Buffer.alloc(54);
  bytes.write("BM", 0, "latin1");
  bytes.writeUInt32LE(54, 2);
  bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14);
  return bytes;
}

/** A Windows program's DOS header, mostly zero bytes. */
function program(): Buffer {
  const bytes = Buffer.alloc(128);
  bytes.write("MZ", 0, "latin1");
  bytes.writeUInt16LE(0x90, 2);
  bytes.writeUInt32LE(0x80, 0x3c);
  return bytes;
}

describe("what a file is, by its bytes", () => {
  it("reads text that begins with the letters of a short signature as text", () => {
    for (const start of [
      "BMW,320i,2019\nAudi,A4,2020\n",
      "MZ-1200 bracket\nMZ-1300 hinge\n",
      "ID3 tags hold an MP3's title\n",
      "GIF8 was the working name\n",
      "GIF89a is the version most tools write.\n",
      "Convert WEBP to PNG\n",
      "RIFF1234WEBP notes\n",
    ])
      expect(fileKind(text(start))).toEqual({ kind: "text" });
  });

  it("names no kind for bytes that start like a bitmap or an MP3 but break its header", () => {
    expect(fileKind(text("BM\x10\x00\x00\x00\x00\x00\x00\x07"))).toEqual({
      kind: "binary",
    });
    expect(fileKind(text("ID3\x03\x01abc"))).toEqual({ kind: "binary" });
  });

  it("names a picture or a program whose header has what a real one has", () => {
    expect(fileKind(bitmap())).toEqual({
      kind: "binary",
      named: "a bitmap image",
      mediaType: "image/bmp",
    });
    expect(fileKind(program())).toEqual({
      kind: "binary",
      named: "a Windows program",
    });
    const riff = Buffer.alloc(32);
    riff.write("RIFF", 0, "latin1");
    riff.writeUInt32LE(24, 4);
    riff.write("WEBPVP8 ", 8, "latin1");
    expect(fileKind(riff)).toMatchObject({ mediaType: "image/webp" });
    expect(fileKind(text("GIF89a\x01\x00\x01\x00\x80\x00\x00"))).toMatchObject({
      mediaType: "image/gif",
    });
  });

  it("finds a PDF whose header follows a line break, a byte-order mark or bytes that are not text", () => {
    const pdf = { kind: "binary", named: "a PDF document" };
    expect(fileKind(text("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n"))).toEqual(pdf);
    expect(fileKind(text("\r\n\n  %PDF-1.7\n"))).toEqual(pdf);
    expect(
      fileKind(
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), text("%PDF-1.4\n")]),
      ),
    ).toEqual(pdf);
    expect(
      fileKind(Buffer.concat([Buffer.alloc(40, 0x01), text("%PDF-1.4\n")])),
    ).toEqual(pdf);
  });

  it("reads text that mentions a PDF header after other words as text", () => {
    expect(fileKind(text("A PDF starts with %PDF- and a version.\n"))).toEqual({
      kind: "text",
    });
  });

  it("looks no further than 1,024 bytes for a PDF's header", () => {
    expect(
      fileKind(Buffer.concat([Buffer.alloc(1_100, 0x01), text("%PDF-1.4\n")])),
    ).toMatchObject({ kind: "binary" });
    expect(
      fileKind(Buffer.concat([Buffer.alloc(1_100, 0x01), text("%PDF-1.4\n")])),
    ).not.toMatchObject({ named: "a PDF document" });
  });

  it("reads text with a byte-order mark for UTF-16 by its characters", () => {
    expect(
      fileKind(
        Buffer.concat([
          Buffer.from([0xff, 0xfe]),
          Buffer.from("Hello", "utf16le"),
        ]),
      ),
    ).toEqual({ kind: "text", encoding: "utf-16le" });
  });
});
