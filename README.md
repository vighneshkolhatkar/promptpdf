# PromptPDF

Edit and update PDFs by typing what you want done — rotate, watermark, sign, redact, merge, fill forms, and more — in plain English. Free to run, free to host, no accounts or credits.

Created by Vighnesh Kolhatkar.

## How it works

1. You upload a PDF. It **never leaves your browser** — all parsing and editing happens client-side with [pdf.js](https://mozilla.github.io/pdf.js/) (reading) and [pdf-lib](https://pdf-lib.js.org/) (writing).
2. You type a request ("rotate all pages and add a CONFIDENTIAL watermark"). A small amount of context (page count, extracted text preview, form field names — never the file itself) is sent to a serverless function, which asks a free LLM ([Groq](https://groq.com/), running Llama 3.3 70B) to translate your request into a structured **edit plan**: a list of operations drawn from a fixed, whitelisted set (rotate, watermark, redact, sign, merge, etc.).
3. The plan is validated against a strict schema and shown to you before anything happens.
4. When you click Apply, your browser executes the plan itself using pre-built, tested functions — the model never generates or runs code.

This design was a deliberate choice over having the LLM write and execute a Python script server-side: that approach means unsandboxed remote code execution on every request, which is both a security liability and hard to host safely for free. Function-calling into a fixed operation set keeps everything deterministic, auditable, and cheap to run.

## Getting a free Groq API key

1. Go to [console.groq.com/keys](https://console.groq.com/keys) and sign up (no credit card required).
2. Create an API key.
3. Copy `.env.local.example` to `.env.local` and paste your key in:
   ```
   cp .env.local.example .env.local
   ```

Groq's free tier is generous and fast; if you ever hit its rate limits, swap in another OpenAI-compatible provider by editing `app/api/plan/route.ts`.

## Running locally

Requires Node 24 (see `.nvmrc`).

```
npm install
npm run dev
```

Then open http://localhost:3000.

## Deploying for free

This is a standard Next.js app — deploy it to [Vercel's free tier](https://vercel.com/):

1. Push this repo to GitHub.
2. Import it in Vercel.
3. Add an environment variable `GROQ_API_KEY` with your free Groq key.
4. Deploy. You get a free `*.vercel.app` URL you can share.

No database, no paid services, no usage-based billing anywhere in this stack.

## What's implemented

Rotate, delete, reorder, extract, and crop pages · add text, page numbers, and watermarks · draw or upload a signature and place it · stamp an image · redact text (see below) · highlight text · fill and flatten AcroForm fields · merge in other uploaded PDFs · split into multiple files · best-effort image compression.

### Filling a form from other documents, in any language

"Additional files" isn't limited to PDFs/images to merge or stamp — upload PDF, DOCX, or TXT source documents there too (e.g. a filled-out reference form, a letter, an ID) and ask PromptPDF to use their content to fill out or write into the main document: *"Fill out this form using the info in `passport-details.docx`"*. The source can be in any language — the model reads and understands it (Hindi is officially well-supported by the underlying Llama model; other languages, including other Indic scripts like Marathi, are best-effort — the app tells you when it's less confident). Values are used as written by default (no silent translation/transliteration) so a name or address doesn't get subtly altered.

Non-Latin text (Devanagari script, e.g. Hindi/Marathi) is rendered with a bundled Noto Sans Devanagari font, embedded on demand — pdf-lib's built-in fonts only support Western European (WinAnsi) text and would otherwise throw outright on this content. Image-only source files aren't readable as text (no OCR in this version) — they can still be used as stamps.

## Security posture

- **Request validation**: `/api/plan` validates the incoming request against a strict schema (`lib/requestSchema.ts`) — capped message count/length, capped context field sizes — and rejects oversized bodies outright, before any LLM call is made.
- **Rate limiting**: a simple in-memory, per-IP limiter (see limitation below).
- **Error handling**: the route never returns a raw stack trace or internal validation detail to the client. Failures are logged server-side (`console.error`) with full detail and return a generic, safe message to the caller.
- **No accounts, no server-side storage of your files or documents** — there's nothing to breach on that front, because it doesn't exist.
- **Dependencies**: audited with `npm audit`; Dependabot is configured (`.github/dependabot.yml`) for weekly automated update PRs. One accepted residual risk: Next.js 16.2.10 bundles its own `postcss@8.4.31` internally (build-time CSS tooling, not part of the runtime request path), which has a known moderate advisory; it can only be resolved by a future Next.js release bumping that internal pin, not by anything in this project's own dependency tree.

## Third-party assets

`public/fonts/NotoSansDevanagari-Regular.ttf` is Google's [Noto Sans Devanagari](https://fonts.google.com/noto/specimen/Noto+Sans+Devanagari), licensed under the SIL Open Font License 1.1 — free to bundle and embed.

## Known limitations (read before relying on this for sensitive documents)

- **Redaction**: when "redact this text" is the only structural change to a page, the matched text is genuinely stripped out of the PDF's content stream — not just covered with a box — and a black box is drawn on top for a clear visual cue. If a single request also draws something else on the *same page* (e.g. "add a watermark and redact my SSN" in one go), that page falls back to a visual-only cover box, and the app tells you so in the results log. For guaranteed removal, redact as its own step.
- **Password protection is not implemented.** pdf-lib (the library this app is built on) doesn't support PDF encryption, and hand-rolling it wasn't worth the risk of a broken or falsely-reassuring implementation. This may come in a future version via a dedicated library.
- **Compression** only re-encodes baseline JPEG images at a lower quality; it won't shrink files that don't contain recompressible images.
- Everything here depends on the browser's [Compression/Canvas APIs](https://caniuse.com/) — use a reasonably modern browser (Chrome, Edge, Firefox, or Safari 16.4+).
- The `/api/plan` rate limit is a simple in-memory counter, reset on every cold start — a soft speed bump, not a hard guarantee, since there's no database in this project.

## Project structure

```
app/
  page.tsx              main UI flow
  api/plan/route.ts      serverless function that calls Groq
  layout.tsx, globals.css
components/               UI pieces (dropzone, prompt box, signature pad, preview, ...)
lib/
  types.ts, planSchema.ts operation schema + validation
  llmTools.ts             tool schema + system prompt handed to the LLM
  pdfContext.ts           client-side text/metadata extraction (pdf.js)
  pdfOperations.ts        whitelisted operation executors (pdf-lib)
  redact.ts               content-stream-level redaction
scripts/
  copy-pdf-worker.mjs     copies the pdf.js worker into public/ on install
  smoke-test.mjs          Node-based regression check for the edit engine
```
