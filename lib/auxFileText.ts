import { loadPdfDocument } from "./pdfContext";
import type { AuxFileKind } from "./types";

// Extracts a text preview from an uploaded "additional file" so its content
// (not just its filename) can inform the LLM's plan — e.g. reading values
// out of a source document to fill a form on the main PDF. Runs entirely
// client-side, same as the main document's own text extraction.

const MAX_CHARS = 4000;

function truncate(text: string): string {
  const cleaned = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  return cleaned.length > MAX_CHARS ? cleaned.slice(0, MAX_CHARS) + "…" : cleaned;
}

async function extractFromPdf(bytes: Uint8Array): Promise<string> {
  const doc = await loadPdfDocument(bytes);
  const parts: string[] = [];
  let total = 0;
  for (let i = 1; i <= doc.numPages && total < MAX_CHARS; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items.map((item) => ("str" in item ? item.str : "")).join(" ");
    parts.push(text);
    total += text.length;
  }
  return parts.join("\n");
}

async function extractFromDocx(bytes: Uint8Array): Promise<string> {
  const mammoth = await import("mammoth");
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

function extractFromPlainText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

// Best-effort: language identification is left entirely to the LLM reading
// this text at planning time (Llama 3.x has broad, if uneven, multilingual
// coverage — Hindi is officially well-supported, other Indic languages
// like Marathi are best-effort). No translation or transliteration happens
// here; this only gets raw text out of the file.
export async function extractAuxFileText(bytes: Uint8Array, kind: AuxFileKind): Promise<string | undefined> {
  try {
    switch (kind) {
      case "pdf":
        return truncate(await extractFromPdf(bytes));
      case "docx":
        return truncate(await extractFromDocx(bytes));
      case "text":
        return truncate(extractFromPlainText(bytes));
      case "image":
        return undefined; // no OCR in this version — images are for stamping only
    }
  } catch {
    return undefined; // a file we can't parse just isn't usable as a text source; not fatal
  }
}
