/**
 * A real PDF, small enough to write by hand: pages of a given size, each with
 * lines of Helvetica text at given places and sizes, so a reader finds them
 * there.
 */

export type TestPage = {
  /** Points, as PDF measures a page. */
  readonly width: number;
  readonly height: number;
  readonly lines?: readonly {
    readonly x: number;
    readonly y: number;
    readonly text: string;
    /** Points; 10 when not given. */
    readonly size?: number;
  }[];
};

/** A4 portrait, in points. */
export const a4 = { width: 595.28, height: 841.89 } as const;

export function pdfWith(pages: readonly TestPage[]): string {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);
  const pageIds = pages.map((_, index) => 4 + index * 2);
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  );
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pages.forEach((page, index) => {
    const content = (page.lines ?? [])
      .map(
        (line) =>
          `BT /F1 ${line.size ?? 10} Tf ${line.x} ${line.y} Td (${line.text.replace(/[()\\]/g, (c) => `\\${c}`)}) Tj ET`,
      )
      .join("\n");
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[index]! + 1} 0 R >>`,
    );
    add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  let file = "%PDF-1.7\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(file.length);
    file += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = file.length;
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    file += `${String(offset).padStart(10, "0")} 00000 n \n`;
  file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return file;
}
