import {
  PDFDocument,
  PDFName,
  PDFRawStream,
  PageSizes,
  degrees,
  rgb,
} from "pdf-lib";
import type { Operation, PageSelector, Position } from "./types";
import { applyRedaction, findTextPositions } from "./redact";
import { resolveFont } from "./unicodeFont";

export interface ExecutionAssets {
  drawnSignaturePng?: Uint8Array;
  uploadedSignaturePng?: Uint8Array;
  images: Record<string, Uint8Array>;
  auxPdfs: Record<string, Uint8Array>;
}

export interface ExecutionResult {
  bytes: Uint8Array;
  splitOutputs?: { name: string; bytes: Uint8Array }[];
  log: string[];
}

function resolvePageIndices(selector: PageSelector, totalPages: number): number[] {
  if (selector === "all") return Array.from({ length: totalPages }, (_, i) => i);
  if (Array.isArray(selector)) {
    return selector.map((n) => n - 1).filter((i) => i >= 0 && i < totalPages);
  }
  const from = Math.max(1, selector.from);
  const to = Math.min(totalPages, selector.to);
  const out: number[] = [];
  for (let p = from; p <= to; p++) out.push(p - 1);
  return out;
}

function hexToRgb(hex?: string) {
  if (!hex) return rgb(0, 0, 0);
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

function resolvePosition(
  position: Position,
  pageWidth: number,
  pageHeight: number,
  elemWidth: number,
  elemHeight: number
) {
  const marginX = pageWidth * 0.05;
  const marginY = pageHeight * 0.05;

  if (typeof position === "object") {
    // The model (and the schema shown to it) treats yPct in natural reading
    // order — 0 = top of the page, 100 = bottom — since that's how anyone
    // (human or model) actually thinks about laying out a document
    // top-to-bottom. PDF space is bottom-origin, so flip it here rather
    // than asking the model to reason in PDF's native, unintuitive
    // coordinate system (observed in testing: without this flip, closings
    // like "Sincerely, [name]" consistently landed near the top of the
    // page instead of the bottom).
    const bottomUpYPct = 100 - position.yPct;
    return {
      x: (position.xPct / 100) * pageWidth - elemWidth / 2,
      y: (bottomUpYPct / 100) * pageHeight - elemHeight / 2,
    };
  }

  switch (position) {
    case "top-left":
      return { x: marginX, y: pageHeight - marginY - elemHeight };
    case "top-center":
      return { x: (pageWidth - elemWidth) / 2, y: pageHeight - marginY - elemHeight };
    case "top-right":
      return { x: pageWidth - marginX - elemWidth, y: pageHeight - marginY - elemHeight };
    case "center":
      return { x: (pageWidth - elemWidth) / 2, y: (pageHeight - elemHeight) / 2 };
    case "bottom-left":
      return { x: marginX, y: marginY };
    case "bottom-center":
      return { x: (pageWidth - elemWidth) / 2, y: marginY };
    case "bottom-right":
      return { x: pageWidth - marginX - elemWidth, y: marginY };
  }
}

function isPng(bytes: Uint8Array) {
  return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

async function embedImageAuto(doc: PDFDocument, bytes: Uint8Array) {
  return isPng(bytes) ? doc.embedPng(bytes) : doc.embedJpg(bytes);
}

async function reencodeJpegAtQuality(bytes: Uint8Array, quality: number): Promise<Uint8Array | null> {
  try {
    const blob = new Blob([bytes as BlobPart], { type: "image/jpeg" });
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    const outBlob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );
    if (!outBlob) return null;
    return new Uint8Array(await outBlob.arrayBuffer());
  } catch {
    return null;
  }
}

// Best-effort compression: finds baseline-JPEG image XObjects in the document
// and re-encodes them at a lower quality via the browser's Canvas API. Other
// image encodings (CMYK JPEG, JBIG2, CCITT) are left untouched rather than
// risking corruption.
async function compressImages(doc: PDFDocument, quality: number, log: string[]) {
  const indirectObjects = doc.context.enumerateIndirectObjects();
  let compressedCount = 0;

  for (const [ref, obj] of indirectObjects) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    const subtype = dict.get(PDFName.of("Subtype"));
    const filter = dict.get(PDFName.of("Filter"));
    const isImage = subtype?.toString() === "/Image";
    const isDct = filter?.toString().includes("DCTDecode");
    if (!isImage || !isDct) continue;

    const original = obj.contents;
    const recompressed = await reencodeJpegAtQuality(original, quality);
    if (recompressed && recompressed.length < original.length) {
      // PDFRawStream.contents is readonly — swap in a new stream object
      // under the same ref rather than mutating in place. Length is
      // recomputed automatically from the new contents at save time.
      doc.context.assign(ref, PDFRawStream.of(dict, recompressed));
      compressedCount++;
    }
  }

  log.push(
    compressedCount > 0
      ? `Recompressed ${compressedCount} image(s).`
      : "No compressible JPEG images found — file may already be optimized."
  );
}

async function applyOperation(
  doc: PDFDocument,
  op: Operation,
  assets: ExecutionAssets,
  originalBytes: Uint8Array,
  log: string[]
): Promise<PDFDocument> {
  const pages = doc.getPages();

  switch (op.op) {
    case "rotate_pages": {
      const indices = resolvePageIndices(op.pages, pages.length);
      for (const i of indices) {
        const page = pages[i];
        const current = page.getRotation().angle;
        page.setRotation(degrees((current + op.degrees) % 360));
      }
      log.push(`Rotated ${indices.length} page(s) by ${op.degrees}°.`);
      return doc;
    }

    case "delete_pages": {
      const indices = resolvePageIndices(op.pages, pages.length).sort((a, b) => b - a);
      for (const i of indices) doc.removePage(i);
      log.push(`Deleted ${indices.length} page(s).`);
      return doc;
    }

    case "reorder_pages": {
      const newDoc = await PDFDocument.create();
      const indices = op.newOrder.map((n) => n - 1).filter((i) => i >= 0 && i < pages.length);
      const copied = await newDoc.copyPages(doc, indices);
      copied.forEach((p) => newDoc.addPage(p));
      log.push(`Reordered pages to: ${op.newOrder.join(", ")}.`);
      return newDoc;
    }

    case "extract_pages": {
      const newDoc = await PDFDocument.create();
      const indices = resolvePageIndices(op.pages, pages.length);
      const copied = await newDoc.copyPages(doc, indices);
      copied.forEach((p) => newDoc.addPage(p));
      log.push(`Extracted ${indices.length} page(s) into the output.`);
      return newDoc;
    }

    case "crop_pages": {
      const indices = resolvePageIndices(op.pages, pages.length);
      for (const i of indices) {
        const page = pages[i];
        const { width, height } = page.getSize();
        const mx = (width * op.marginPct) / 100;
        const my = (height * op.marginPct) / 100;
        page.setCropBox(mx, my, width - 2 * mx, height - 2 * my);
      }
      log.push(`Cropped ${indices.length} page(s) by ${op.marginPct}% margin.`);
      return doc;
    }

    case "add_text": {
      const font = await resolveFont(doc, op.text);
      const indices = resolvePageIndices(op.pages, pages.length);
      const fontSize = op.fontSize ?? 14;
      for (const i of indices) {
        const page = pages[i];
        const { width, height } = page.getSize();
        const textWidth = font.widthOfTextAtSize(op.text, fontSize);
        const { x, y } = resolvePosition(op.position, width, height, textWidth, fontSize);
        page.drawText(op.text, { x, y, size: fontSize, font, color: hexToRgb(op.color) });
      }
      log.push(`Added text to ${indices.length} page(s).`);
      return doc;
    }

    case "add_page_numbers": {
      const total = pages.length;
      const start = op.startAt ?? 1;
      const format = op.format ?? "Page {n} of {total}";
      const font = await resolveFont(doc, format);
      pages.forEach((page, i) => {
        const label = format.replace("{n}", String(start + i)).replace("{total}", String(total));
        const { width } = page.getSize();
        const fontSize = 10;
        const textWidth = font.widthOfTextAtSize(label, fontSize);
        const { x, y } = resolvePosition(
          op.position ?? "bottom-center",
          width,
          page.getHeight(),
          textWidth,
          fontSize
        );
        page.drawText(label, { x, y, size: fontSize, font, color: rgb(0.2, 0.2, 0.2) });
      });
      log.push(`Added page numbers to all ${total} page(s).`);
      return doc;
    }

    case "add_watermark": {
      const font = await resolveFont(doc, op.text);
      const indices = resolvePageIndices(op.pages ?? "all", pages.length);
      const fontSize = op.fontSize ?? 60;
      for (const i of indices) {
        const page = pages[i];
        const { width, height } = page.getSize();
        const textWidth = font.widthOfTextAtSize(op.text, fontSize);
        page.drawText(op.text, {
          x: width / 2 - textWidth / 2,
          y: height / 2,
          size: fontSize,
          font,
          color: hexToRgb(op.color ?? "#808080"),
          opacity: op.opacity ?? 0.25,
          rotate: degrees(op.rotationDegrees ?? 45),
        });
      }
      log.push(`Watermarked ${indices.length} page(s) with "${op.text}".`);
      return doc;
    }

    case "add_signature":
    case "add_stamp_image": {
      const page = pages[op.page - 1];
      if (!page) throw new Error(`Page ${op.page} does not exist.`);
      const bytes =
        op.op === "add_signature"
          ? op.signatureRef === "drawn"
            ? assets.drawnSignaturePng
            : assets.uploadedSignaturePng
          : assets.images[op.imageRef];
      if (!bytes) {
        throw new Error(
          op.op === "add_signature"
            ? "No signature was provided. Draw or upload one first."
            : `Referenced image "${op.imageRef}" was not found.`
        );
      }
      const image = await embedImageAuto(doc, bytes);
      const { width: pw, height: ph } = page.getSize();
      const widthPct = op.widthPct ?? 25;
      const drawWidth = pw * (widthPct / 100);
      const drawHeight = drawWidth * (image.height / image.width);
      const { x, y } = resolvePosition(op.position, pw, ph, drawWidth, drawHeight);
      page.drawImage(image, { x, y, width: drawWidth, height: drawHeight });
      log.push(op.op === "add_signature" ? "Placed signature on the page." : "Placed stamp image on the page.");
      return doc;
    }

    case "highlight_text": {
      const indices = resolvePageIndices(op.pages ?? "all", pages.length);
      const { positions } = await findTextPositions(originalBytes, op.searchText, indices, false);
      const color = hexToRgb(op.color ?? "#ffe066");
      for (const match of positions) {
        const page = pages[match.pageIndex];
        page.drawRectangle({
          x: match.x,
          y: match.y,
          width: match.width,
          height: match.height,
          color,
          opacity: 0.4,
        });
      }
      log.push(`Highlighted ${positions.length} match(es) of "${op.searchText}".`);
      return doc;
    }

    case "redact_text": {
      const { totalMatches, fallbackPages } = await applyRedaction(doc, originalBytes, op);
      log.push(`Redacted ${totalMatches} match(es) of "${op.searchText}" (text removed, not just covered).`);
      if (fallbackPages.length > 0) {
        log.push(
          `Note: on page(s) ${fallbackPages.join(", ")}, this edit combined redaction with other changes to the same page, so only a visual cover box was applied there — the underlying text may still be extractable. Redact as its own step for guaranteed removal.`
        );
      }
      return doc;
    }

    case "fill_form_fields": {
      const form = doc.getForm();
      let filled = 0;
      // Any field's value might need the Unicode fallback font (e.g. a
      // name filled in from a Hindi source document) — resolve once
      // against everything being written and apply it uniformly, rather
      // than letting pdf-lib silently fall back to its default WinAnsi-only
      // Helvetica at save time, which throws outright on non-Latin text.
      const combinedValues = op.fields.map((f) => f.value).join(" ");
      const fieldFont = await resolveFont(doc, combinedValues);
      for (const { name, value } of op.fields) {
        try {
          const tf = form.getTextField(name);
          tf.setText(value);
          filled++;
          continue;
        } catch {
          /* not a text field */
        }
        try {
          const cb = form.getCheckBox(name);
          if (["true", "yes", "1", "checked"].includes(value.toLowerCase())) cb.check();
          else cb.uncheck();
          filled++;
          continue;
        } catch {
          /* not a checkbox */
        }
        try {
          const dd = form.getDropdown(name);
          dd.select(value);
          filled++;
          continue;
        } catch {
          /* not a dropdown */
        }
        try {
          const rg = form.getRadioGroup(name);
          rg.select(value);
          filled++;
        } catch {
          log.push(`Could not find or fill form field "${name}".`);
        }
      }
      // Generate appearances with the resolved font ourselves — leaving
      // this to happen implicitly (at .save() or inside flatten()) would
      // use pdf-lib's default Helvetica and throw on non-Latin text.
      form.updateFieldAppearances(fieldFont);
      if (op.flatten) form.flatten({ updateFieldAppearances: false });
      log.push(`Filled ${filled} of ${op.fields.length} form field(s)${op.flatten ? " and flattened the form." : "."}`);
      return doc;
    }

    case "merge_pdfs": {
      for (const ref of op.fileRefs) {
        const bytes = assets.auxPdfs[ref];
        if (!bytes) throw new Error(`Referenced file "${ref}" to merge was not found.`);
        const otherDoc = await PDFDocument.load(bytes);
        const copied = await doc.copyPages(otherDoc, otherDoc.getPageIndices());
        copied.forEach((p) => doc.addPage(p));
      }
      log.push(`Merged ${op.fileRefs.length} additional PDF(s).`);
      return doc;
    }

    case "compress_pdf": {
      await compressImages(doc, op.imageQuality ?? 0.6, log);
      return doc;
    }

    case "split_pdf": {
      // Handled specially by executePlan (produces multiple outputs).
      return doc;
    }

    case "create_blank_pdf": {
      // Only meaningful as the first operation; executePlan handles that
      // case before this switch ever runs. If it shows up elsewhere in the
      // plan (malformed or model error), ignore it rather than discarding
      // everything already built.
      log.push("Ignored a create_blank_pdf that wasn't the first step.");
      return doc;
    }

    default: {
      const _exhaustive: never = op;
      throw new Error(`Unsupported operation: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// A trivial, valid, always-loadable one-page blank PDF used as the starting
// point for "create a new PDF from scratch" sessions — the rest of the app
// (context extraction, execution) then treats it exactly like an upload.
// The LLM's own create_blank_pdf operation replaces its page count/size as
// needed; this is just a safe, guaranteed-parseable seed.
export async function createStarterBlankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage(PageSizes.Letter);
  return doc.save();
}

export async function executePlan(
  inputBytes: Uint8Array,
  operations: Operation[],
  assets: ExecutionAssets
): Promise<ExecutionResult> {
  const log: string[] = [];
  let doc: PDFDocument;
  let remainingOps = operations;

  const createOp = operations[0];
  if (createOp?.op === "create_blank_pdf") {
    const size = createOp.pageSize === "a4" ? PageSizes.A4 : PageSizes.Letter;
    doc = await PDFDocument.create();
    for (let i = 0; i < createOp.pageCount; i++) doc.addPage(size);
    log.push(`Created a new blank ${createOp.pageCount}-page PDF (${createOp.pageSize ?? "letter"}).`);
    remainingOps = operations.slice(1);
  } else {
    doc = await PDFDocument.load(inputBytes);
  }

  let splitOutputs: ExecutionResult["splitOutputs"];

  for (const op of remainingOps) {
    if (op.op === "split_pdf") {
      splitOutputs = [];
      for (const [idx, range] of op.ranges.entries()) {
        const part = await PDFDocument.create();
        const indices = resolvePageIndices({ from: range.from, to: range.to }, doc.getPageCount());
        const copied = await part.copyPages(doc, indices);
        copied.forEach((p) => part.addPage(p));
        const bytes = await part.save();
        splitOutputs.push({ name: `part-${idx + 1}-pages-${range.from}-${range.to}.pdf`, bytes });
      }
      log.push(`Split into ${op.ranges.length} file(s).`);
      continue;
    }
    doc = await applyOperation(doc, op, assets, inputBytes, log);
  }

  const bytes = await doc.save();
  return { bytes, splitOutputs, log };
}
