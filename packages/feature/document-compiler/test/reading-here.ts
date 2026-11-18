/**
 * A compiled PDF read back in this process, with pdf.js, for tests. The app
 * hands the compiler the contained process every PDF is read in (ADR 0019);
 * the compiler holds no reader of its own. The compilers here read with this
 * one unless a test names another.
 */

import {
  loadPdfjs,
  pdfDocumentOptions,
  textOfItem,
  type PdfDocument,
} from "@zhiyin/pdf-engine";
import {
  documentCompiler as compilerFor,
  documentCompilers as compilersFor,
  type CompiledPdfReader,
  type DocumentCompilerOptions,
} from "../src/index.js";

type Options = Omit<DocumentCompilerOptions, "readBack"> & {
  readonly readBack?: CompiledPdfReader;
};

const readingHere: CompiledPdfReader = {
  async open(bytes) {
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument(pdfDocumentOptions(bytes));
    let document: PdfDocument;
    const pages: { width: number; height: number }[] = [];
    try {
      document = await task.promise;
      for (let number = 1; number <= document.numPages; number += 1) {
        const { width, height } = (await document.getPage(number)).getViewport({
          scale: 1,
        });
        pages.push({ width, height });
      }
    } catch {
      await task.destroy().catch(() => undefined);
      return { ok: false, failure: "unopenable" };
    }
    return {
      ok: true,
      pages,
      async placed(number) {
        if (number < 1 || number > pages.length) return undefined;
        const page = (await document.getPage(number)) as Awaited<
          ReturnType<PdfDocument["getPage"]>
        > & { readonly view: readonly number[] };
        const { items, styles } = (await page.getTextContent()) as {
          readonly items: readonly {
            readonly transform: readonly number[];
            readonly width: number;
            readonly height: number;
            readonly fontName: string;
          }[];
          readonly styles?: Readonly<
            Record<
              string,
              { readonly ascent?: number; readonly descent?: number }
            >
          >;
        };
        page.cleanup();
        return {
          view: [...page.view],
          items: items.map((item) => {
            const style = styles?.[item.fontName];
            return {
              text: textOfItem(item),
              transform: item.transform,
              width: item.width,
              height: item.height,
              ...(style?.ascent !== undefined ? { ascent: style.ascent } : {}),
              ...(style?.descent !== undefined
                ? { descent: style.descent }
                : {}),
            };
          }),
        };
      },
      close() {
        void task.destroy().catch(() => undefined);
      },
    };
  },
};

/** The compiler for one folder, reading back here unless told otherwise. */
export function documentCompiler(options: Options) {
  return compilerFor({ readBack: readingHere, ...options });
}

/** One compiler for every folder, reading back here unless told otherwise. */
export function documentCompilers(options: Omit<Options, "workspaceRoot">) {
  return compilersFor({ readBack: readingHere, ...options });
}
