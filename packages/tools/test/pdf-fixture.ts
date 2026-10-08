/**
 * A small, real PDF, built here rather than checked in as bytes.
 *
 * The point of the read tests is that a PDF is read the way a PDF is read, so
 * the fixture has to be one a PDF reader accepts — a file of made-up bytes
 * with a `%PDF` header would prove only that the header was recognised.
 */
export function simplePdf(
  pages: readonly string[],
  size: { readonly width: number; readonly height: number } = {
    width: 612,
    height: 792,
  },
): Buffer {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const contentIds = pages.map((text) => {
    // One drawn string per line, as a real document does. A reader returns the
    // strings a page draws, and a single line running off the page is not one.
    const lines = text.match(/.{1,70}(?:\s|$)/g) ?? [text];
    const stream = lines
      .map(
        (line, index) =>
          `BT /F1 10 Tf 72 ${740 - (index % 60) * 12} Td (${line.trim()}) Tj ET`,
      )
      .join("\n");
    return add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pagesId = objects.length + pages.length + 1;
  const pageIds = contentIds.map((contentId) =>
    add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${size.width} ${size.height}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    ),
  );
  const pagesObjectId = add(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`,
  );
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesObjectId} 0 R >>`);
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
