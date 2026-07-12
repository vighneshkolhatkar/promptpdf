// pdf.js needs its worker script served as a plain static file. Copying it
// into public/ (rather than relying on bundler-specific `new URL(...,
// import.meta.url)` magic) works identically under Turbopack, webpack, or
// any future bundler, and needs no CDN dependency.
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const src = path.join(root, "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs");
const destDir = path.join(root, "public");
const dest = path.join(destDir, "pdf.worker.min.mjs");

// The worker runs in its own global scope, separate from the main thread —
// polyfilling Promise.withResolvers there (see lib/pdfContext.ts for why)
// doesn't reach here, so it's prepended directly into the served file.
const polyfill = `if(typeof Promise.withResolvers!=="function"){Promise.withResolvers=function(){let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});return{promise,resolve,reject};};}\n`;

mkdirSync(destDir, { recursive: true });
writeFileSync(dest, polyfill + readFileSync(src, "utf8"));
console.log(`Copied pdf.js worker to ${path.relative(root, dest)} (with Promise.withResolvers polyfill)`);
