import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { extractDocumentContext } = await import("../lib/pdfContext.ts");
const { executePlan } = await import("../lib/pdfOperations.ts");

const inputPath = process.argv[2];
const bytes = new Uint8Array(readFileSync(inputPath));

console.log("=== Extracting context from original ===");
const ctx = await extractDocumentContext(bytes);
console.log("pageCount:", ctx.pageCount);
console.log("textPreview:", ctx.textPreview.slice(0, 300));
console.log("formFields:", ctx.formFields);

const operations = [
  { op: "rotate_pages", pages: { from: 1, to: 1 }, degrees: 90 },
  { op: "add_watermark", text: "CONFIDENTIAL", opacity: 0.3 },
  { op: "add_page_numbers", format: "Page {n} of {total}" },
  { op: "add_text", pages: "all", text: "Stamped by smoke test", position: "top-left" },
  { op: "redact_text", searchText: "ZEBRA-42" },
  { op: "highlight_text", searchText: "total due" },
  { op: "delete_pages", pages: [3] },
];

console.log("\n=== Executing plan ===");
const result = await executePlan(bytes, operations, { images: {}, auxPdfs: {} });
console.log("log:", result.log);
console.log("output size:", result.bytes.length, "bytes");

const outPath = path.join(__dirname, "..", "..", "smoke-output.pdf");
writeFileSync(outPath, result.bytes);
console.log("wrote", outPath);

console.log("\n=== Extracting context from EDITED output ===");
const outCtx = await extractDocumentContext(result.bytes);
console.log("pageCount (expect 2, started at 3 minus deleted page 3):", outCtx.pageCount);
console.log("textPreview:", outCtx.textPreview);

const stillHasSecret = outCtx.textPreview.includes("ZEBRA-42");
console.log("\n=== REDACTION CHECK ===");
console.log(stillHasSecret ? "FAIL: secret text still present!" : "PASS: secret text fully removed from extracted text");

const hasWatermark = outCtx.textPreview.includes("CONFIDENTIAL");
console.log(hasWatermark ? "PASS: watermark text present" : "FAIL: watermark text missing");

const hasPageNum = outCtx.textPreview.includes("Page 1 of");
console.log(hasPageNum ? "PASS: page numbers present" : "FAIL: page numbers missing");
