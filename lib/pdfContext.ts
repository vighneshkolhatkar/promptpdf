import type { PDFDocumentProxy } from "pdfjs-dist";
import type { DocumentContext } from "./types";

let pdfjsLib: typeof import("pdfjs-dist/legacy/build/pdf.mjs") | null = null;

// Lazily import pdfjs-dist and point it at its own worker build, copied
// into public/ at install time (see scripts/copy-pdf-worker.mjs) and served
// as a plain static file. This works identically under any bundler and has
// no third-party CDN dependency. PDFJS_WORKER_SRC lets test scripts running
// outside the browser (e.g. scripts/smoke-test.mjs) point at the file
// directly instead of a served URL; it's never set in the browser bundle.
async function getPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  lib.GlobalWorkerOptions.workerSrc = process.env.PDFJS_WORKER_SRC ?? "/pdf.worker.min.mjs";
  pdfjsLib = lib;
  return lib;
}

export async function loadPdfDocument(bytes: ArrayBuffer | Uint8Array): Promise<PDFDocumentProxy> {
  const lib = await getPdfjs();
  const data = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes.slice(0));
  const loadingTask = lib.getDocument({ data });
  return loadingTask.promise;
}

// Kept deliberately tight — this text is resent to the LLM on every single
// planning call in the conversation, so its size is a direct, recurring
// token cost. The model mostly needs enough to understand structure and
// content *presence* for planning (rotate/watermark/sign/etc. don't need
// full text at all; redact/highlight matching happens client-side against
// pdf.js-extracted positions, not against this preview), not a faithful
// full-text copy.
const MAX_CHARS_PER_PAGE = 500;
const MAX_TOTAL_CHARS = 6000;

export async function extractDocumentContext(
  bytes: ArrayBuffer | Uint8Array,
  auxiliaryFiles: DocumentContext["hasAuxiliaryFiles"] = []
): Promise<Omit<DocumentContext, "availableSignatures">> {
  const doc = await loadPdfDocument(bytes);
  const pageCount = doc.numPages;
  const pageSizes: DocumentContext["pageSizes"] = [];
  const pageTexts: string[] = [];
  let totalChars = 0;

  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    pageSizes.push({ width: viewport.width, height: viewport.height });

    if (totalChars < MAX_TOTAL_CHARS) {
      const textContent = await page.getTextContent();
      let text = textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length > MAX_CHARS_PER_PAGE) {
        text = text.slice(0, MAX_CHARS_PER_PAGE) + "…";
      }
      pageTexts.push(`[Page ${i}] ${text}`);
      totalChars += text.length;
    }
  }

  let formFields: DocumentContext["formFields"] = [];
  try {
    const fieldObjects = await doc.getFieldObjects();
    if (fieldObjects) {
      formFields = Object.entries(fieldObjects).map(([name, entries]) => ({
        name,
        type: (entries[0] as { type?: string } | undefined)?.type ?? "unknown",
      }));
    }
  } catch {
    // Non-fatal: some PDFs have no AcroForm, or pdf.js can't introspect it.
  }

  return {
    pageCount,
    pageSizes,
    textPreview: pageTexts.join("\n"),
    formFields,
    hasAuxiliaryFiles: auxiliaryFiles,
  };
}
