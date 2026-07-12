import { PDFDocument as PDFLibDocument } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { DocumentContext } from "./types";

// pdfjs-dist 6.x calls Promise.withResolvers() internally — including in the
// "legacy" build — but that method only landed in Safari 17.4 (March 2024).
// On any iPhone running an older iOS this throws "undefined is not a
// function" the instant a PDF is loaded. Polyfill it before pdf.js runs.
// (The worker thread has its own separate global scope, so this alone
// doesn't cover code running there — see scripts/copy-pdf-worker.mjs.)
if (typeof Promise.withResolvers !== "function") {
  Promise.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

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
      // Some PDFs (font/encoding quirks pdf.js's getTextContent trips on —
      // seen concretely on WebKit/Safari) throw here even though the page
      // renders and every other operation on it works fine. Text preview is
      // only ever used as LLM context, not for rendering or editing, so a
      // per-page failure here shouldn't block the whole document from
      // loading — just skip that page's text.
      try {
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
      } catch {
        pageTexts.push(`[Page ${i}] (text unavailable)`);
      }
    }
  }

  // Read form fields via pdf-lib rather than pdf.js's getFieldObjects().
  // pdf-lib is a completely separate implementation (no font/glyph text
  // extraction involved) and is the same library that actually performs
  // fill_form_fields later — so the fields we tell the LLM about are
  // guaranteed to be the ones we can actually fill, and this sidesteps the
  // pdf.js/WebKit font-encoding quirks that can silently zero out field
  // detection here (the same class of bug as the getTextContent crash
  // above) without any indication that anything went wrong.
  let formFields: DocumentContext["formFields"] = [];
  try {
    const formDoc = await PDFLibDocument.load(bytes, { ignoreEncryption: true });
    formFields = formDoc
      .getForm()
      .getFields()
      .map((field) => ({
        name: field.getName(),
        type: field.constructor.name.replace(/^PDF/, "").replace(/Field$/, "") || "unknown",
      }));
  } catch {
    // Non-fatal: some PDFs have no AcroForm, or it can't be parsed as one.
  }

  return {
    pageCount,
    pageSizes,
    textPreview: pageTexts.join("\n"),
    formFields,
    hasAuxiliaryFiles: auxiliaryFiles,
  };
}
