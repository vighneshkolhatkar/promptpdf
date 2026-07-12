// @pdf-lib/fontkit's bundled build assumes a global regeneratorRuntime
// (compiled against an older Babel target) that modern bundlers don't
// inject automatically — this polyfills it. Importing it here rather than
// at the app entry keeps the cost scoped to this module, only loaded when
// non-Latin text is actually being drawn.
import "regenerator-runtime/runtime";
import fontkit from "@pdf-lib/fontkit";
import { StandardFonts } from "pdf-lib";
import type { PDFDocument, PDFFont } from "pdf-lib";

// pdf-lib's built-in StandardFonts (Helvetica, etc.) only support WinAnsi
// encoding — Western European Latin script. Any text outside that (Hindi,
// Marathi, and other Devanagari-script content, which is the whole point of
// reading source documents in those languages) throws at save time. Noto
// Sans Devanagari covers Devanagari *and* Latin/digits/punctuation in one
// font, so it's fetched and embedded lazily — only when text actually needs
// it — and reused for the rest of that document's operations.
const UNICODE_FONT_URL = "/fonts/NotoSansDevanagari-Regular.ttf";

interface FontCacheEntry {
  helvetica?: PDFFont;
  unicode?: PDFFont;
  fontkitRegistered?: boolean;
}

// Keyed by PDFDocument instance, not a plain object threaded through call
// sites — fonts are tied to the specific document they were embedded into,
// and a plan can swap in a brand new PDFDocument mid-execution (reorder_pages,
// extract_pages both build a fresh doc and hand it back). A WeakMap keyed on
// the document itself makes "never reuse a font across documents" structural
// rather than something every call site has to remember to reset.
const fontCaches = new WeakMap<PDFDocument, FontCacheEntry>();

function isEncodableWith(font: PDFFont, text: string): boolean {
  try {
    font.widthOfTextAtSize(text, 10);
    return true;
  } catch {
    return false;
  }
}

export async function resolveFont(doc: PDFDocument, text: string): Promise<PDFFont> {
  let cache = fontCaches.get(doc);
  if (!cache) {
    cache = {};
    fontCaches.set(doc, cache);
  }

  if (!cache.helvetica) cache.helvetica = await doc.embedFont(StandardFonts.Helvetica);
  if (isEncodableWith(cache.helvetica, text)) return cache.helvetica;

  if (!cache.unicode) {
    if (!cache.fontkitRegistered) {
      doc.registerFontkit(fontkit);
      cache.fontkitRegistered = true;
    }
    const fontBytes = await fetch(UNICODE_FONT_URL).then((r) => {
      if (!r.ok) throw new Error(`Could not load the Unicode font (${r.status}).`);
      return r.arrayBuffer();
    });
    cache.unicode = await doc.embedFont(fontBytes, { subset: true });
  }
  return cache.unicode;
}
