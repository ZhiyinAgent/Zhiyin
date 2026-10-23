/**
 * Real PDFs, built here rather than checked in as bytes, each one a reader
 * accepts — a file of made-up bytes behind a `%PDF` header would prove only
 * that the header was recognised.
 */
import { deflateSync } from "node:zlib";

export type PdfParts = {
  readonly pages?: number;
  readonly size?: { readonly width: number; readonly height: number };
  /** Added to the catalog, such as an action that runs when it opens. */
  readonly catalog?: string;
  /** Added to every page, such as link annotations. */
  readonly page?: string;
  /** Objects the extras above refer to, numbered from 1000. */
  readonly objects?: readonly string[];
  /** A font dictionary used for the text instead of Helvetica. */
  readonly font?: string;
  /** The lines drawn on every page, one under the other, instead of its name. */
  readonly lines?: readonly string[];
  /** Added to every page's resources, such as the images it draws. */
  readonly resources?: string;
  /** Drawn on every page after the lines, such as an image. */
  readonly content?: string;
  readonly trailer?: string;
};

export function pdf(parts: PdfParts = {}): Buffer {
  const count = parts.pages ?? 1;
  const size = parts.size ?? { width: 612, height: 792 };
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);
  add("<< /Type /Catalog /Pages 2 0 R" + (parts.catalog ?? "") + " >>");
  add(
    `<< /Type /Pages /Kids [${Array.from({ length: count }, (_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${count} >>`,
  );
  add(parts.font ?? "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (let index = 0; index < count; index++) {
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size.width} ${size.height}] /Resources << /Font << /F1 3 0 R >>${parts.resources ?? ""} >> /Contents ${5 + index * 2} 0 R${parts.page ?? ""} >>`,
    );
    const stream = [
      ...(parts.lines ?? [`Page ${index + 1}`]).map(
        (line, row) =>
          `BT /F1 24 Tf 72 ${size.height - 100 - row * 30} Td (${line}) Tj ET`,
      ),
      ...(parts.content ? [parts.content] : []),
    ].join("\n");
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let out = "%PDF-1.7\n";
  const offsets: [number, number][] = [];
  objects.forEach((body, index) => {
    offsets.push([index + 1, out.length]);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  (parts.objects ?? []).forEach((body, index) => {
    offsets.push([1000 + index, out.length]);
    out += `${1000 + index} 0 obj\n${body}\nendobj\n`;
  });
  // A cross-reference table that is exact for the main objects; the extras
  // are found by the reader's own reconstruction when they are referred to.
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const [, offset] of offsets.slice(0, objects.length))
    out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  const extras = offsets.slice(objects.length);
  if (extras.length) {
    out += `1000 ${extras.length}\n`;
    for (const [, offset] of extras)
      out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${extras.length ? 1000 + extras.length : objects.length + 1} /Root 1 0 R${parts.trailer ?? ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/**
 * Protected by a password nobody here knows: the standard security handler,
 * with check values the empty password does not match.
 */
export function protectedPdf(): Buffer {
  const hex = (byte: string) => `<${byte.repeat(32)}>`;
  return pdf({
    objects: [
      `<< /Filter /Standard /V 1 /R 2 /Length 40 /O ${hex("41")} /U ${hex("42")} /P -4 >>`,
    ],
    trailer: ` /Encrypt 1000 0 R /ID [<0123456789abcdef0123456789abcdef> <0123456789abcdef0123456789abcdef>]`,
  });
}

/**
 * A document that tries everything a document can try: script when it opens,
 * a link out, a form that submits, and the font matrix that let text run as
 * code in pdf.js before 4.2.67 (CVE-2024-4367). Each would set a global or
 * reach the network if it ran.
 */
export function hostilePdf(): Buffer {
  const payload =
    "1 0 0 1 0 0) /FontMatrix [1 0 0 1 0 (0\\); globalThis.zhiyinRan = true; //";
  return pdf({
    catalog:
      " /OpenAction 1000 0 R /AcroForm << /Fields [1002 0 R] >> /Names << /JavaScript << /Names [(run) 1000 0 R] >> >>",
    page: " /Annots [1001 0 R 1002 0 R]",
    font: `<< /Type /Font /Subtype /Type1 /BaseFont /Zhiyin /FontMatrix [1 0 0 1 0 (${payload})] /FirstChar 0 /LastChar 0 /Widths [600] >>`,
    objects: [
      "<< /Type /Action /S /JavaScript /JS (globalThis.zhiyinRan = true; app.launchURL('https://example.invalid/');) >>",
      "<< /Type /Annot /Subtype /Link /Rect [72 600 300 640] /A << /S /URI /URI (https://example.invalid/clicked) >> >>",
      "<< /Type /Annot /Subtype /Widget /FT /Btn /T (send) /Rect [72 500 200 540] /A << /S /SubmitForm /F (https://example.invalid/submit) >> >>",
    ],
  });
}

type Image = {
  readonly width: number;
  readonly height: number;
  /** The image's filter and its parameters, as they appear in its dictionary. */
  readonly filter: string;
  readonly bitsPerPixel: 1 | 8;
  readonly data: Buffer;
};

/**
 * One line of text, with one black image drawn 200 points square below it, its
 * corner 300 points up and 72 in. The image is greyscale, so a pixel of 0 is
 * black.
 */
function imagePdf(line: string, image: Image): Buffer {
  return pdf({
    lines: [line],
    resources: " /XObject << /Im1 1000 0 R >>",
    content: "q 200 0 0 200 72 300 cm /Im1 Do Q",
    objects: [
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent ${image.bitsPerPixel} ${image.filter} /Length ${image.data.length} >>\nstream\n${image.data.toString("latin1")}\nendstream`,
    ],
  });
}

/**
 * A scanned page: a black image coded as office scanners code one, CCITT
 * group 4 fax. With nothing changing from row to row, each row is a few codes:
 * the first, against the white row a scan starts from, says "no white, then 16
 * black"; every later row says "same changes as the row above". The block ends
 * with its end-of-block code.
 */
export function scannedPdf(): Buffer {
  const side = 16;
  return imagePdf("Scanned", {
    width: side,
    height: side,
    filter: `/Filter /CCITTFaxDecode /DecodeParms << /K -1 /Columns ${side} /Rows ${side} >>`,
    bitsPerPixel: 1,
    data: blackSquareGroupFour(side),
  });
}

/** The black square of `scannedPdf`, coded as CCITT group 4 codes it. */
function blackSquareGroupFour(side: number): Buffer {
  const horizontal = "001";
  const whiteRunOfNone = "00110101";
  const blackRunOf16 = "0000010111";
  const sameAsAbove = "1";
  let bits =
    horizontal +
    whiteRunOfNone +
    blackRunOf16 +
    (sameAsAbove + sameAsAbove).repeat(side - 1) +
    "000000000001".repeat(2);
  bits = bits.padEnd(Math.ceil(bits.length / 8) * 8, "0");
  return Buffer.from(
    Array.from({ length: bits.length / 8 }, (_, index) =>
      parseInt(bits.slice(index * 8, index * 8 + 8), 2),
    ),
  );
}

/**
 * A page scanned as JBIG2, as scanners and archives keep black-and-white
 * pages: the same black square, as a PDF embeds JBIG2, a page's segments
 * without a file header. A page information segment, then the square as an
 * immediate generic region coded with MMR, which is group 4, then the page's
 * end. In JBIG2 a 1 is black.
 */
export function jbigTwoPdf(): Buffer {
  const side = 16;
  const segment = (number: number, type: number, data: Buffer) => {
    const header = Buffer.alloc(11);
    header.writeUInt32BE(number, 0);
    header.writeUInt8(type, 4); // one-byte page association
    header.writeUInt8(0, 5); // refers to no segment
    header.writeUInt8(1, 6); // page 1
    header.writeUInt32BE(data.length, 7);
    return Buffer.concat([header, data]);
  };
  const page = Buffer.alloc(19);
  page.writeUInt32BE(side, 0);
  page.writeUInt32BE(side, 4);
  // Resolutions unknown, a white page, not striped.
  const region = Buffer.alloc(18);
  region.writeUInt32BE(side, 0);
  region.writeUInt32BE(side, 4);
  // At the page's corner, combined by OR; then the region's flags: MMR.
  region.writeUInt8(1, 17);
  const data = Buffer.concat([
    segment(0, 48, page),
    segment(1, 38, Buffer.concat([region, blackSquareGroupFour(side)])),
    segment(2, 49, Buffer.alloc(0)),
  ]);
  return imagePdf("Scanned", {
    width: side,
    height: side,
    filter: "/Filter /JBIG2Decode",
    bitsPerPixel: 1,
    data,
  });
}

/**
 * A page holding a JPEG 2000 image, as archives keep them: a black square 16
 * pixels on a side, coded without loss. The codestream is the one Pillow 12.2
 * writes for `Image.new("L", (16, 16), 0)`, without its comment.
 */
export function jpegTwoThousandPdf(): Buffer {
  const codestream =
    "ff4fff510029000000000010000000100000000000000000000000100000001000000000000000000001070101" +
    "ff52000c00000001000404040001" +
    "ff5c00104040484850484850484850484850" +
    "ff90000a0000000000160001ff93df80080780808080ffd9";
  return imagePdf("Archived", {
    width: 16,
    height: 16,
    filter: "/Filter /JPXDecode",
    bitsPerPixel: 8,
    data: Buffer.from(codestream, "hex"),
  });
}

/**
 * A page whose image is past the bound on what is decoded, 8,000 by 8,001
 * pixels, all black. Compressed, it is a few kilobytes; decoded and drawn, a
 * quarter of a gigabyte.
 */
export function oversizedImagePdf(): Buffer {
  const width = 8_000;
  const height = 8_001;
  return imagePdf("Oversized", {
    width,
    height,
    filter: "/Filter /FlateDecode",
    bitsPerPixel: 1,
    data: deflateSync(Buffer.alloc((width / 8) * height)),
  });
}

/**
 * Chinese text, 中文, in STSong-Light: one of the standard Chinese fonts a
 * reader is expected to have, so the file embeds none (iText writes these). Its
 * text is coded as UCS-2 and mapped to the font's characters through the
 * UniGB-UCS2-H character map, which the reader has to supply too.
 */
export function chinesePdf(): Buffer {
  return pdf({
    lines: [],
    font: "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 1000 0 R /DW 1000 >>] >>",
    content: "BT /F1 24 Tf 72 692 Td <4E2D6587> Tj ET",
    objects: [
      "<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 93 >>",
    ],
  });
}
