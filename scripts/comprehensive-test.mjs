// Exercises every operation in lib/pdfOperations.ts directly (bypassing the
// LLM) with real correctness assertions, not just "did it throw". Run with:
//   PDFJS_WORKER_SRC="file://$(pwd)/public/pdf.worker.min.mjs" npx tsx scripts/comprehensive-test.mjs
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const { extractDocumentContext, loadPdfDocument } = await import("../lib/pdfContext.ts");
const { executePlan } = await import("../lib/pdfOperations.ts");

let pass = 0;
let fail = 0;
function check(label, condition, detail) {
  if (condition) {
    pass++;
    console.log(`PASS  ${label}`);
  } else {
    fail++;
    console.log(`FAIL  ${label}${detail ? " — " + detail : ""}`);
  }
}

async function makeBasicPdf(pageCount = 3) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pageCount; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page ${i} marker text`, { x: 50, y: 700, size: 16, font });
  }
  return doc.save();
}

async function makeFormPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText("Form", { x: 50, y: 740, size: 16, font });
  const form = doc.getForm();
  const tf = form.createTextField("full_name");
  tf.addToPage(page, { x: 150, y: 700, width: 200, height: 20 });
  const cb = form.createCheckBox("agree");
  cb.addToPage(page, { x: 150, y: 660, width: 20, height: 20 });
  return doc.save();
}

async function makeRedPng() {
  // Minimal 2x2 red PNG, hand-built is overkill — use pdf-lib to draw and
  // export via an offscreen approach isn't available in Node, so embed a
  // tiny known-good PNG byte sequence instead (1x1 red pixel).
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return new Uint8Array(Buffer.from(b64, "base64"));
}

const emptyAssets = { images: {}, auxPdfs: {} };

// --- rotate_pages ---
{
  const bytes = await makeBasicPdf(2);
  const out = await executePlan(bytes, [{ op: "rotate_pages", pages: "all", degrees: 90 }], emptyAssets);
  const doc = await PDFDocument.load(out.bytes);
  const angle = doc.getPage(0).getRotation().angle;
  check("rotate_pages sets rotation angle", angle === 90, `got ${angle}`);
}

// --- delete_pages ---
{
  const bytes = await makeBasicPdf(3);
  const out = await executePlan(bytes, [{ op: "delete_pages", pages: [2] }], emptyAssets);
  const ctx = await extractDocumentContext(out.bytes);
  check("delete_pages reduces page count", ctx.pageCount === 2, `got ${ctx.pageCount}`);
  check(
    "delete_pages removes the right page",
    ctx.textPreview.includes("Page 1 marker") && ctx.textPreview.includes("Page 3 marker") && !ctx.textPreview.includes("Page 2 marker"),
    ctx.textPreview
  );
}

// --- reorder_pages ---
{
  const bytes = await makeBasicPdf(3);
  const out = await executePlan(bytes, [{ op: "reorder_pages", newOrder: [3, 1, 2] }], emptyAssets);
  const ctx = await extractDocumentContext(out.bytes);
  const firstPageText = ctx.textPreview.split("\n")[0];
  check("reorder_pages puts the requested page first", firstPageText.includes("Page 3 marker"), firstPageText);
}

// --- extract_pages ---
{
  const bytes = await makeBasicPdf(3);
  const out = await executePlan(bytes, [{ op: "extract_pages", pages: { from: 2, to: 3 } }], emptyAssets);
  const ctx = await extractDocumentContext(out.bytes);
  check("extract_pages yields correct page count", ctx.pageCount === 2, `got ${ctx.pageCount}`);
  check("extract_pages excludes page 1", !ctx.textPreview.includes("Page 1 marker"), ctx.textPreview);
}

// --- crop_pages ---
{
  const bytes = await makeBasicPdf(1);
  const out = await executePlan(bytes, [{ op: "crop_pages", pages: "all", marginPct: 10 }], emptyAssets);
  const doc = await PDFDocument.load(out.bytes);
  const box = doc.getPage(0).getCropBox();
  check("crop_pages shrinks the crop box", box.width < 612 && box.height < 792, `${box.width}x${box.height}`);
}

// --- add_blank_pages ---
{
  const bytes = await makeBasicPdf(2);
  const out = await executePlan(bytes, [{ op: "add_blank_pages", count: 2, position: "end" }], emptyAssets);
  const ctx = await extractDocumentContext(out.bytes);
  check("add_blank_pages appends the right count at the end", ctx.pageCount === 4, `got ${ctx.pageCount}`);
  check(
    "add_blank_pages keeps existing pages first",
    ctx.textPreview.includes("Page 1 marker") && ctx.textPreview.includes("Page 2 marker"),
    ctx.textPreview
  );
}
{
  const bytes = await makeBasicPdf(2);
  const out = await executePlan(bytes, [{ op: "add_blank_pages", count: 1, position: "start" }], emptyAssets);
  const ctx = await extractDocumentContext(out.bytes);
  check("add_blank_pages prepends at the start", ctx.pageCount === 3, `got ${ctx.pageCount}`);
  const firstPageText = ctx.textPreview.split("\n")[0];
  check("add_blank_pages new first page is blank", !firstPageText.includes("marker"), firstPageText);
}
{
  // add_blank_pages composed with add_text on the newly appended page —
  // the exact pattern the model is now guided to use for "add a week's
  // workout plan"-style requests.
  const bytes = await makeBasicPdf(1);
  const out = await executePlan(
    bytes,
    [
      { op: "add_blank_pages", count: 1, position: "end" },
      { op: "add_text", pages: [2], text: "Day 1: Push-ups\nDay 2: Squats", position: "top-left" },
    ],
    emptyAssets
  );
  const ctx = await extractDocumentContext(out.bytes);
  check("add_blank_pages composes with add_text on the new page", ctx.pageCount === 2 && ctx.textPreview.includes("Day 1: Push-ups"), ctx.textPreview);
}
{
  // Regression test: multi-line add_text anchored at the BOTTOM of the page
  // used to place line 1's baseline at the margin and let every subsequent
  // line draw *below* that (off the page) — drawText advances downward per
  // line, so a naive single-line position calc clips a multi-line block.
  // Verify via pdf.js's actual glyph transforms, not just text presence
  // (text extraction doesn't care whether a glyph was on-page or not).
  const bytes = await makeBasicPdf(1);
  const out = await executePlan(
    bytes,
    [{ op: "add_text", pages: [1], text: "Line one\nLine two\nLine three", position: "bottom-left", fontSize: 12 }],
    emptyAssets
  );
  const pdfDoc = await loadPdfDocument(out.bytes);
  const page = await pdfDoc.getPage(1);
  const textContent = await page.getTextContent();
  const ys = textContent.items.map((item) => item.transform[5]);
  check(
    "multi-line add_text keeps every line's baseline on the page (bottom-anchored)",
    ys.length > 0 && ys.every((y) => y >= 0 && y <= page.getViewport({ scale: 1 }).height),
    `y positions: ${ys.join(", ")}`
  );
}
{
  // Regression test: a model that writes one long unbroken line (no "\n" of
  // its own — the exact real-world failure this was caught by, live, in
  // manual testing) used to run text off the right edge of the page.
  // add_text must now wrap it automatically regardless.
  const bytes = await makeBasicPdf(1);
  const longLine =
    "Weekly Workout Plan Monday: 30 minutes jogging, 30 minutes weightlifting Tuesday: 45 minutes yoga, 30 minutes cardio Wednesday: 30 minutes swimming";
  const out = await executePlan(bytes, [{ op: "add_text", pages: [1], text: longLine, position: "top-left", fontSize: 12 }], emptyAssets);
  const pdfDoc = await loadPdfDocument(out.bytes);
  const page = await pdfDoc.getPage(1);
  const pageWidth = page.getViewport({ scale: 1 }).width;
  const textContent = await page.getTextContent();
  // pdf.js emits one item per drawn line for text with embedded line
  // breaks — more than one item here means the single long input line was
  // actually split into multiple drawn lines, i.e. wrapping happened.
  check("add_text wraps an unbroken long line into multiple lines", textContent.items.length > 1, `${textContent.items.length} line item(s)`);
  const xs = textContent.items.map((item) => item.transform[4]);
  const widths = textContent.items.map((item) => item.width ?? 0);
  check(
    "add_text wrapped lines stay within the page width",
    xs.every((x, i) => x + widths[i] <= pageWidth),
    `right edges: ${xs.map((x, i) => x + widths[i]).join(", ")} vs page width ${pageWidth}`
  );
}

// --- add_text ---
{
  const bytes = await makeBasicPdf(1);
  const out = await executePlan(bytes, [{ op: "add_text", pages: "all", text: "Injected Line", position: "bottom-left" }], emptyAssets);
  const ctx = await extractDocumentContext(out.bytes);
  check("add_text adds visible text", ctx.textPreview.includes("Injected Line"), ctx.textPreview);
}

// --- add_page_numbers ---
{
  const bytes = await makeBasicPdf(2);
  const out = await executePlan(bytes, [{ op: "add_page_numbers", format: "Page {n} of {total}" }], emptyAssets);
  const ctx = await extractDocumentContext(out.bytes);
  check("add_page_numbers labels each page", ctx.textPreview.includes("Page 1 of 2") && ctx.textPreview.includes("Page 2 of 2"), ctx.textPreview);
}

// --- add_watermark ---
// Note: pdf.js's text *extraction* (not rendering) truncates the last
// couple characters of glyph runs rotated at 45° — a pdf.js quirk
// confirmed independent of this app's drawing code (a 0°-rotation
// watermark extracts perfectly; visually the 45° watermark still renders
// its full text correctly, as verified in manual browser testing). Checking
// a prefix here instead of full equality avoids a false-positive failure
// from that library-level extraction quirk.
{
  const bytes = await makeBasicPdf(1);
  const out = await executePlan(bytes, [{ op: "add_watermark", text: "SAMPLE-WATERMARK" }], emptyAssets);
  const ctx = await extractDocumentContext(out.bytes);
  check("add_watermark adds watermark text", ctx.textPreview.includes("SAMPLE-WATERMA"), ctx.textPreview);
}

// --- add_signature (drawn) ---
{
  const bytes = await makeBasicPdf(1);
  const sig = await makeRedPng();
  const out = await executePlan(
    bytes,
    [{ op: "add_signature", page: 1, position: "bottom-right", signatureRef: "drawn" }],
    { ...emptyAssets, drawnSignaturePng: sig }
  );
  // Simplest reliable check: file grew (image embedded) and no throw occurred.
  check("add_signature embeds without throwing and grows file size", out.bytes.length > bytes.length, `${bytes.length} -> ${out.bytes.length}`);
}

// --- add_stamp_image ---
{
  const bytes = await makeBasicPdf(1);
  const img = await makeRedPng();
  const out = await executePlan(
    bytes,
    [{ op: "add_stamp_image", page: 1, position: "top-left", imageRef: "img-1" }],
    { ...emptyAssets, images: { "img-1": img } }
  );
  check("add_stamp_image embeds without throwing and grows file size", out.bytes.length > bytes.length, `${bytes.length} -> ${out.bytes.length}`);
}

// --- redact_text (standalone, true removal) ---
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText("The secret code is ZEBRA-99 today.", { x: 50, y: 700, size: 12, font });
  const bytes = await doc.save();
  const out = await executePlan(bytes, [{ op: "redact_text", searchText: "ZEBRA-99" }], emptyAssets);
  const ctx = await extractDocumentContext(out.bytes);
  check("redact_text truly removes the text", !ctx.textPreview.includes("ZEBRA-99"), ctx.textPreview);
  check("redact_text log confirms true removal, not a fallback", out.log.some((l) => l.includes("Redacted 1")) && !out.log.some((l) => l.includes("fallback")), out.log.join(" | "));
}

// --- highlight_text ---
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText("Please review the total due amount.", { x: 50, y: 700, size: 12, font });
  const bytes = await doc.save();
  const out = await executePlan(bytes, [{ op: "highlight_text", searchText: "total due" }], emptyAssets);
  const ctx = await extractDocumentContext(out.bytes);
  check("highlight_text preserves the original text", ctx.textPreview.includes("total due"), ctx.textPreview);
  check("highlight_text reports a match", out.log.some((l) => l.includes("Highlighted 1")), out.log.join(" | "));
}

// --- fill_form_fields ---
{
  const bytes = await makeFormPdf();
  const out = await executePlan(
    bytes,
    [{ op: "fill_form_fields", fields: [{ name: "full_name", value: "Jordan Rivera" }, { name: "agree", value: "true" }] }],
    emptyAssets
  );
  const doc = await PDFDocument.load(out.bytes);
  const form = doc.getForm();
  let tfValue = null;
  try {
    tfValue = form.getTextField("full_name").getText();
  } catch {}
  check("fill_form_fields sets the text field value", tfValue === "Jordan Rivera", `got ${tfValue}`);
}

// --- fill_form_fields with flatten ---
{
  const bytes = await makeFormPdf();
  const out = await executePlan(
    bytes,
    [{ op: "fill_form_fields", fields: [{ name: "full_name", value: "Flattened Name" }], flatten: true }],
    emptyAssets
  );
  const ctx = await extractDocumentContext(out.bytes);
  check("fill_form_fields+flatten bakes the value into page text", ctx.textPreview.includes("Flattened Name"), ctx.textPreview);
}

// --- merge_pdfs ---
{
  const bytes = await makeBasicPdf(2);
  const other = await makeBasicPdf(1);
  const out = await executePlan(bytes, [{ op: "merge_pdfs", fileRefs: ["other-1"] }], { ...emptyAssets, auxPdfs: { "other-1": other } });
  const ctx = await extractDocumentContext(out.bytes);
  check("merge_pdfs combines page counts", ctx.pageCount === 3, `got ${ctx.pageCount}`);
}

// --- split_pdf ---
{
  const bytes = await makeBasicPdf(4);
  const out = await executePlan(bytes, [{ op: "split_pdf", ranges: [{ from: 1, to: 2 }, { from: 3, to: 4 }] }], emptyAssets);
  check("split_pdf produces two output files", out.splitOutputs?.length === 2, `got ${out.splitOutputs?.length}`);
  if (out.splitOutputs?.length === 2) {
    const ctx1 = await extractDocumentContext(out.splitOutputs[0].bytes);
    const ctx2 = await extractDocumentContext(out.splitOutputs[1].bytes);
    check("split_pdf part 1 has 2 pages", ctx1.pageCount === 2, `got ${ctx1.pageCount}`);
    check("split_pdf part 2 has 2 pages", ctx2.pageCount === 2, `got ${ctx2.pageCount}`);
  }
}

// --- compress_pdf (no crash on a doc with no images) ---
{
  const bytes = await makeBasicPdf(1);
  const out = await executePlan(bytes, [{ op: "compress_pdf" }], emptyAssets);
  check("compress_pdf completes without throwing", out.bytes.length > 0);
}

// --- create_blank_pdf ---
{
  const out = await executePlan(
    new Uint8Array(),
    [
      { op: "create_blank_pdf", pageCount: 2, pageSize: "a4" },
      { op: "add_text", pages: "all", text: "From scratch", position: "center" },
    ],
    emptyAssets
  );
  const ctx = await extractDocumentContext(out.bytes);
  check("create_blank_pdf creates the requested page count", ctx.pageCount === 2, `got ${ctx.pageCount}`);
  check("create_blank_pdf composes with add_text", ctx.textPreview.includes("From scratch"), ctx.textPreview);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
