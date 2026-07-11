// pdf.js needs its worker script served as a plain static file. Copying it
// into public/ (rather than relying on bundler-specific `new URL(...,
// import.meta.url)` magic) works identically under Turbopack, webpack, or
// any future bundler, and needs no CDN dependency.
import { copyFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const src = path.join(root, "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs");
const destDir = path.join(root, "public");
const dest = path.join(destDir, "pdf.worker.min.mjs");

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`Copied pdf.js worker to ${path.relative(root, dest)}`);
