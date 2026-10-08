/**
 * Real PDFs, built here rather than checked in as bytes, each one a reader
 * accepts — a file of made-up bytes behind a `%PDF` header would prove only
 * that the header was recognised.
 */

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
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size.width} ${size.height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R${parts.page ?? ""} >>`,
    );
    const stream = (parts.lines ?? [`Page ${index + 1}`])
      .map(
        (line, row) =>
          `BT /F1 24 Tf 72 ${size.height - 100 - row * 30} Td (${line}) Tj ET`,
      )
      .join("\n");
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
