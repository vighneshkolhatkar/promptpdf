import { PDFArray, PDFName, PDFRawStream, decodePDFRawStream, rgb } from "pdf-lib";
import type { PDFDocument, PDFStream } from "pdf-lib";
import type { OpRedactText, PageSelector } from "./types";
import { loadPdfDocument } from "./pdfContext";

// Cache the parsed pdf.js document per input buffer so redacting/highlighting
// across many pages in one call doesn't reparse the whole file each time.
const pdfjsDocCache = new WeakMap<Uint8Array, Promise<import("pdfjs-dist").PDFDocumentProxy>>();
function getCachedPdfjsDoc(originalBytes: Uint8Array) {
  let cached = pdfjsDocCache.get(originalBytes);
  if (!cached) {
    cached = loadPdfDocument(originalBytes);
    pdfjsDocCache.set(originalBytes, cached);
  }
  return cached;
}

// --- Content-stream tokenizer -----------------------------------------
// A minimal scanner for PDF page content streams: just enough to find
// text-showing operators (Tj, TJ, ', ") and the byte ranges of the string
// operands that feed them. Not a general PDF parser — comments, dict
// operands (e.g. inline marked-content properties), arrays, names and
// numbers are only skipped over, never interpreted.

interface StrToken {
  type: "str" | "hexstr";
  start: number;
  end: number;
  innerStart: number;
  innerEnd: number;
}
type Token =
  | StrToken
  | { type: "dict" | "arrayStart" | "arrayEnd" | "name" | "num" | "op"; start: number; end: number };

function isWhitespace(b: number) {
  return b === 0x00 || b === 0x09 || b === 0x0a || b === 0x0c || b === 0x0d || b === 0x20;
}
function isDelimiter(b: number) {
  return [0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25].includes(b);
}

function tokenizeContentStream(bytes: Uint8Array): Token[] {
  const tokens: Token[] = [];
  const n = bytes.length;
  let i = 0;
  while (i < n) {
    const b = bytes[i];
    if (isWhitespace(b)) {
      i++;
      continue;
    }
    if (b === 0x25) {
      while (i < n && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++;
      continue;
    }
    if (b === 0x28) {
      const start = i;
      i++;
      let depth = 1;
      const innerStart = i;
      while (i < n && depth > 0) {
        const c = bytes[i];
        if (c === 0x5c) {
          i += 2;
          continue;
        }
        if (c === 0x28) depth++;
        else if (c === 0x29) depth--;
        i++;
      }
      tokens.push({ type: "str", start, end: i, innerStart, innerEnd: i - 1 });
      continue;
    }
    if (b === 0x3c) {
      if (bytes[i + 1] === 0x3c) {
        const start = i;
        i += 2;
        let depth = 1;
        while (i < n && depth > 0) {
          if (bytes[i] === 0x3c && bytes[i + 1] === 0x3c) {
            depth++;
            i += 2;
          } else if (bytes[i] === 0x3e && bytes[i + 1] === 0x3e) {
            depth--;
            i += 2;
          } else i++;
        }
        tokens.push({ type: "dict", start, end: i });
        continue;
      }
      const start = i;
      i++;
      const innerStart = i;
      while (i < n && bytes[i] !== 0x3e) i++;
      const innerEnd = i;
      i++;
      tokens.push({ type: "hexstr", start, end: i, innerStart, innerEnd });
      continue;
    }
    if (b === 0x5b) {
      tokens.push({ type: "arrayStart", start: i, end: i + 1 });
      i++;
      continue;
    }
    if (b === 0x5d) {
      tokens.push({ type: "arrayEnd", start: i, end: i + 1 });
      i++;
      continue;
    }
    if (b === 0x2f) {
      const start = i;
      i++;
      while (i < n && !isWhitespace(bytes[i]) && !isDelimiter(bytes[i])) i++;
      tokens.push({ type: "name", start, end: i });
      continue;
    }
    if ((b >= 0x30 && b <= 0x39) || b === 0x2b || b === 0x2d || b === 0x2e) {
      const start = i;
      i++;
      while (
        i < n &&
        ((bytes[i] >= 0x30 && bytes[i] <= 0x39) ||
          bytes[i] === 0x2e ||
          bytes[i] === 0x2b ||
          bytes[i] === 0x2d ||
          bytes[i] === 0x45 ||
          bytes[i] === 0x65)
      )
        i++;
      tokens.push({ type: "num", start, end: i });
      continue;
    }
    const start = i;
    if (b === 0x27 || b === 0x22) {
      i++;
    } else {
      while (i < n && !isWhitespace(bytes[i]) && !isDelimiter(bytes[i])) i++;
      if (i === start) i++; // guard against getting stuck on a stray delimiter byte
    }
    tokens.push({ type: "op", start, end: i });
  }
  return tokens;
}

interface TextShowUnit {
  stringRanges: { start: number; end: number }[];
}

function extractTextShowUnits(tokens: Token[], bytes: Uint8Array): TextShowUnit[] {
  const units: TextShowUnit[] = [];
  const opName = (t: Token) => new TextDecoder("ascii").decode(bytes.slice(t.start, t.end));

  for (let idx = 0; idx < tokens.length; idx++) {
    const t = tokens[idx];
    if (t.type !== "op") continue;
    const name = opName(t);

    if (name === "Tj" || name === "'" || name === '"') {
      const prev = tokens[idx - 1];
      if (prev && (prev.type === "str" || prev.type === "hexstr")) {
        units.push({ stringRanges: [{ start: prev.innerStart, end: prev.innerEnd }] });
      } else {
        units.push({ stringRanges: [] });
      }
    } else if (name === "TJ") {
      let j = idx - 1;
      const stringRanges: { start: number; end: number }[] = [];
      if (tokens[j] && tokens[j].type === "arrayEnd") {
        let depth = 1;
        j--;
        while (j >= 0 && depth > 0) {
          const tk = tokens[j];
          if (tk.type === "arrayEnd") depth++;
          else if (tk.type === "arrayStart") {
            depth--;
            if (depth === 0) break;
          } else if (tk.type === "str" || tk.type === "hexstr") {
            stringRanges.push({ start: tk.innerStart, end: tk.innerEnd });
          }
          j--;
        }
      }
      units.push({ stringRanges: stringRanges.reverse() });
    }
  }
  return units;
}

function blankRanges(bytes: Uint8Array, ranges: { start: number; end: number }[]): Uint8Array {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const chunks: Uint8Array[] = [];
  let cursor = 0;
  for (const r of sorted) {
    chunks.push(bytes.slice(cursor, r.start));
    cursor = r.end;
  }
  chunks.push(bytes.slice(cursor));
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

// --- Position lookup (pdf.js), used for highlighting and the visual
// fallback/cover box that always accompanies a redaction --------------

export interface TextMatch {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

function resolveIndicesForPage(pages: "all" | PageSelector | undefined, totalPages: number): number[] {
  if (!pages || pages === "all") return Array.from({ length: totalPages }, (_, i) => i);
  if (Array.isArray(pages)) return pages.map((n) => n - 1).filter((i) => i >= 0 && i < totalPages);
  const from = Math.max(1, pages.from);
  const to = Math.min(totalPages, pages.to);
  const out: number[] = [];
  for (let p = from; p <= to; p++) out.push(p - 1);
  return out;
}

async function getPageItems(originalBytes: Uint8Array, pageIndex: number) {
  const pdfjsDoc = await getCachedPdfjsDoc(originalBytes);
  const page = await pdfjsDoc.getPage(pageIndex + 1);
  const textContent = await page.getTextContent({ disableCombineTextItems: true } as any);
  // pdf.js inserts synthetic empty-string items to mark line breaks even
  // with combining disabled. They carry no text to search or redact, and
  // including them would throw off the 1:1 correspondence applyRedaction
  // relies on between text-showing operators and items, so drop them here
  // for every caller.
  return textContent.items.filter((it): it is any => "str" in it && it.str.length > 0);
}

function findMatchSpans(items: any[], searchText: string, matchCase: boolean) {
  const needle = matchCase ? searchText : searchText.toLowerCase();
  const charToItem: number[] = [];
  let concatenated = "";
  items.forEach((item, itemIdx) => {
    for (let c = 0; c < item.str.length; c++) charToItem.push(itemIdx);
    concatenated += item.str;
    // A single boundary character between items so a search term can't
    // accidentally span two unrelated text runs (e.g. the end of one line
    // and the start of the next) as if they were adjacent.
    concatenated += " ";
    charToItem.push(-1);
  });
  const haystack = matchCase ? concatenated : concatenated.toLowerCase();

  const matchedItemIndices = new Set<number>();
  let searchFrom = 0;
  while (needle.length > 0) {
    const at = haystack.indexOf(needle, searchFrom);
    if (at === -1) break;
    for (let c = at; c < at + needle.length && c < charToItem.length; c++) {
      if (charToItem[c] >= 0) matchedItemIndices.add(charToItem[c]);
    }
    searchFrom = at + needle.length;
  }
  return matchedItemIndices;
}

export async function findTextPositions(
  originalBytes: Uint8Array,
  searchText: string,
  pageIndices: number[],
  matchCase: boolean
): Promise<{ positions: TextMatch[] }> {
  const positions: TextMatch[] = [];
  for (const pageIndex of pageIndices) {
    const items = await getPageItems(originalBytes, pageIndex);
    const matched = findMatchSpans(items, searchText, matchCase);
    for (const itemIdx of matched) {
      const item = items[itemIdx];
      const [, , , d, e, f] = item.transform;
      const height = Math.abs(d) || item.height || 10;
      positions.push({ pageIndex, x: e, y: f - height * 0.15, width: item.width, height: height * 1.2 });
    }
  }
  return { positions };
}

// --- True redaction ----------------------------------------------------
// Strips the matched text's string operands out of the page's content
// stream (so it is not just visually covered but genuinely absent from
// the saved PDF), then draws an opaque box over the same area for a clear
// visual cue. Falls back to visual-only covering for a given page when its
// content isn't decodable this way (e.g. an unsupported stream filter, or
// a page whose content mixes in an appended draw operation from an earlier
// step in the same edit plan) — always logged, never silent.

// A page's Contents entry is a single stream in the simple case, but
// pdf-lib itself (and many other real-world producers) commonly split it
// into an array of streams that are logically concatenated. Decode
// whichever shape it is into one buffer, or return null if any part isn't
// a plain raw stream we can decode.
function decodeAllPageContent(contents: PDFStream | PDFArray | undefined): Uint8Array | null {
  const streams: PDFRawStream[] = [];
  if (contents instanceof PDFRawStream) {
    streams.push(contents);
  } else if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
      const item = contents.lookup(i);
      if (!(item instanceof PDFRawStream)) return null;
      streams.push(item);
    }
  } else {
    return null;
  }

  const decodedParts = streams.map((s) => decodePDFRawStream(s).decode());
  if (decodedParts.length === 1) return decodedParts[0];
  const total = decodedParts.reduce((sum, p) => sum + p.length + 1, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of decodedParts) {
    out.set(part, offset);
    offset += part.length;
    out[offset] = 0x0a;
    offset += 1;
  }
  return out;
}

export interface RedactionResult {
  totalMatches: number;
  fallbackPages: number[]; // 1-indexed pages where visual-only covering was used instead of true removal
}

export async function applyRedaction(doc: PDFDocument, originalBytes: Uint8Array, op: OpRedactText): Promise<RedactionResult> {
  const pages = doc.getPages();
  const pageIndices = resolveIndicesForPage(op.pages, pages.length);
  const matchCase = op.matchCase ?? false;
  let totalMatches = 0;
  const fallbackPages: number[] = [];

  for (const pageIndex of pageIndices) {
    const page = pages[pageIndex];
    const items = await getPageItems(originalBytes, pageIndex);
    const matchedItemIndices = findMatchSpans(items, op.searchText, matchCase);
    if (matchedItemIndices.size === 0) continue;

    let trueRemovalOk = false;
    const contents = page.node.Contents();
    const decoded = contents ? decodeAllPageContent(contents) : null;

    if (decoded) {
      try {
        const tokens = tokenizeContentStream(decoded);
        const units = extractTextShowUnits(tokens, decoded);

        if (units.length === items.length) {
          const rangesToBlank: { start: number; end: number }[] = [];
          for (const itemIdx of matchedItemIndices) {
            for (const range of units[itemIdx].stringRanges) rangesToBlank.push(range);
          }
          const newBytes = blankRanges(decoded, rangesToBlank);
          const newStream = doc.context.flateStream(newBytes);
          const ref = doc.context.register(newStream);
          page.node.set(PDFName.of("Contents"), ref);
          trueRemovalOk = true;
        }
      } catch {
        trueRemovalOk = false;
      }
    }

    // Always draw an opaque cover box, whether or not true removal succeeded.
    for (const itemIdx of matchedItemIndices) {
      const item = items[itemIdx];
      const [, , , d, e, f] = item.transform;
      const height = Math.abs(d) || item.height || 10;
      page.drawRectangle({
        x: e,
        y: f - height * 0.15,
        width: item.width,
        height: height * 1.2,
        color: rgb(0, 0, 0),
      });
    }

    totalMatches += matchedItemIndices.size;
    if (!trueRemovalOk) fallbackPages.push(pageIndex + 1);
  }

  return { totalMatches, fallbackPages };
}
