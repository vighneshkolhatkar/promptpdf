"use client";

import { useMemo, useState } from "react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Dropzone } from "@/components/Dropzone";
import { SuggestionChips, SUGGESTED_PROMPTS, CREATE_SUGGESTED_PROMPTS } from "@/components/SuggestionChips";
import { PromptBox } from "@/components/PromptBox";
import { PdfPreview } from "@/components/PdfPreview";
import { SignatureModal } from "@/components/SignatureModal";
import { OperationLog, describeOperation } from "@/components/OperationLog";
import { extractDocumentContext } from "@/lib/pdfContext";
import { executePlan, createStarterBlankPdf, type ExecutionAssets } from "@/lib/pdfOperations";
import type { ChatMessage, DocumentContext, EditPlan } from "@/lib/types";

interface AuxFile {
  id: string;
  name: string;
  kind: "pdf" | "image";
  bytes: Uint8Array;
}

type BaseContext = Omit<DocumentContext, "hasAuxiliaryFiles" | "availableSignatures">;

function download(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes.slice() as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// The preview should jump to wherever the edit actually landed rather than
// always showing page 1 — otherwise an edit to e.g. the last page (a common
// default for signatures) looks like nothing happened.
function computePreviewPage(operations: EditPlan["operations"]): number {
  for (let i = operations.length - 1; i >= 0; i--) {
    const op = operations[i];
    if (op.op === "add_signature" || op.op === "add_stamp_image") return op.page;
  }
  return 1;
}

export default function Home() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
  const [startedFromScratch, setStartedFromScratch] = useState(false);
  const [baseContext, setBaseContext] = useState<BaseContext | null>(null);
  const [auxFiles, setAuxFiles] = useState<AuxFile[]>([]);
  const [signature, setSignature] = useState<{ drawn?: Uint8Array; uploaded?: Uint8Array }>({});
  const [showSignatureModal, setShowSignatureModal] = useState(false);

  const [prompt, setPrompt] = useState("");
  const [conversation, setConversation] = useState<ChatMessage[]>([]);
  const [isLoadingPlan, setIsLoadingPlan] = useState(false);
  const [plan, setPlan] = useState<EditPlan | null>(null);

  const [isExecuting, setIsExecuting] = useState(false);
  const [resultPreviewPage, setResultPreviewPage] = useState(1);
  const [lastResultLog, setLastResultLog] = useState<string[] | null>(null);
  const [lastSplitOutputs, setLastSplitOutputs] = useState<{ name: string; bytes: Uint8Array }[] | undefined>(undefined);

  const [error, setError] = useState<string | null>(null);

  const documentContext: DocumentContext | null = useMemo(() => {
    if (!baseContext) return null;
    return {
      ...baseContext,
      hasAuxiliaryFiles: auxFiles.map(({ id, name, kind }) => ({ id, name, kind })),
      availableSignatures: { drawn: !!signature.drawn, uploaded: !!signature.uploaded },
    };
  }, [baseContext, auxFiles, signature]);

  function resetSession() {
    setFileBytes(null);
    setFileName(null);
    setStartedFromScratch(false);
    setBaseContext(null);
    setConversation([]);
    setPlan(null);
    setLastResultLog(null);
    setLastSplitOutputs(undefined);
    setError(null);
    setPrompt("");
  }

  async function handleMainFile(files: File[]) {
    resetSession();
    const file = files[0];
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    setFileName(file.name);
    setFileBytes(bytes);
    try {
      const ctx = await extractDocumentContext(bytes);
      setBaseContext(ctx);
    } catch (e) {
      setError(e instanceof Error ? `Could not read this PDF: ${e.message}` : "Could not read this PDF.");
    }
  }

  async function handleStartFromScratch() {
    resetSession();
    setStartedFromScratch(true);
    const bytes = await createStarterBlankPdf();
    setFileName("Untitled.pdf");
    setFileBytes(bytes);
    setBaseContext(await extractDocumentContext(bytes));
  }

  async function handleAuxFiles(files: File[]) {
    const additions: AuxFile[] = [];
    for (const file of files) {
      const kind: AuxFile["kind"] = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "image";
      const bytes = new Uint8Array(await file.arrayBuffer());
      additions.push({ id: `file-${Date.now()}-${additions.length}`, name: file.name, kind, bytes });
    }
    setAuxFiles((prev) => [...prev, ...additions]);
  }

  async function handleGeneratePlan() {
    if (!fileBytes || !documentContext || prompt.trim().length === 0) return;
    const nextConversation: ChatMessage[] = [...conversation, { role: "user", content: prompt }];
    setConversation(nextConversation);
    setPrompt("");
    setIsLoadingPlan(true);
    setError(null);
    setPlan(null);
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextConversation, documentContext }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong generating the plan.");
        return;
      }
      const editPlan = data as EditPlan;
      setPlan(editPlan);
      // Keep the conversation going either way — a clarification question or
      // a proposed plan both become part of the history, so the user's next
      // message (an answer, or a follow-up tweak) has full context.
      setConversation([
        ...nextConversation,
        { role: "assistant", content: editPlan.clarificationNeeded || editPlan.explanation || "Okay." },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the planning service.");
    } finally {
      setIsLoadingPlan(false);
    }
  }

  function missingAssetWarnings(): string[] {
    if (!plan) return [];
    const warnings: string[] = [];
    for (const op of plan.operations) {
      if (op.op === "add_signature") {
        const has = op.signatureRef === "drawn" ? signature.drawn : signature.uploaded;
        if (!has) warnings.push(`Add a ${op.signatureRef} signature before applying — the plan needs one.`);
      }
      if (op.op === "add_stamp_image" && !auxFiles.some((f) => f.id === op.imageRef && f.kind === "image")) {
        warnings.push(`Upload the image referenced as "${op.imageRef}" before applying.`);
      }
      if (op.op === "merge_pdfs") {
        for (const ref of op.fileRefs) {
          if (!auxFiles.some((f) => f.id === ref && f.kind === "pdf")) {
            warnings.push(`Upload the PDF referenced as "${ref}" before applying.`);
          }
        }
      }
    }
    return warnings;
  }

  async function handleApply() {
    if (!fileBytes || !plan) return;
    setIsExecuting(true);
    setError(null);
    try {
      const assets: ExecutionAssets = {
        drawnSignaturePng: signature.drawn,
        uploadedSignaturePng: signature.uploaded,
        images: Object.fromEntries(auxFiles.filter((f) => f.kind === "image").map((f) => [f.id, f.bytes])),
        auxPdfs: Object.fromEntries(auxFiles.filter((f) => f.kind === "pdf").map((f) => [f.id, f.bytes])),
      };
      const out = await executePlan(fileBytes, plan.operations, assets);
      // Subsequent turns build on this result, not the original upload —
      // otherwise a second edit in the same session would silently discard
      // the first one instead of compounding on top of it.
      setFileBytes(out.bytes);
      setBaseContext(await extractDocumentContext(out.bytes));
      setResultPreviewPage(computePreviewPage(plan.operations));
      setLastResultLog(out.log);
      setLastSplitOutputs(out.splitOutputs);
      setPlan(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply this edit plan.");
    } finally {
      setIsExecuting(false);
    }
  }

  const warnings = missingAssetWarnings();

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        {!fileBytes && (
          <section className="mx-auto max-w-xl">
            <h1 className="text-center font-serif text-3xl italic">Upload a PDF to get started</h1>
            <p className="mt-2 text-center text-ink/50">
              Then just type what you want done — rotate, watermark, sign, redact, merge, and more.
            </p>
            <div className="mt-8">
              <Dropzone
                accept="application/pdf"
                label="Drop your PDF here"
                hint="or click to browse — stays on your device"
                onFiles={handleMainFile}
              />
            </div>
            <div className="mt-6 flex items-center gap-3 text-xs text-ink/35">
              <div className="h-px flex-1 bg-ink/10" />
              or
              <div className="h-px flex-1 bg-ink/10" />
            </div>
            <button
              type="button"
              onClick={handleStartFromScratch}
              className="mt-6 w-full rounded-2xl border border-dashed border-ink/15 py-4 text-center text-sm text-ink/60 transition-colors hover:border-accent/50 hover:text-ink"
            >
              Create a new PDF from scratch instead
            </button>
          </section>
        )}

        {fileBytes && (
          <div className="grid gap-8 md:grid-cols-[280px_1fr]">
            <div className="flex flex-col items-center gap-4 md:items-start">
              <PdfPreview
                bytes={fileBytes}
                label={lastResultLog ? "Preview (edited)" : startedFromScratch ? "New document" : fileName ?? "Preview"}
                initialPage={lastResultLog ? resultPreviewPage : 1}
              />
              <button type="button" onClick={resetSession} className="text-sm text-ink/50 underline decoration-ink/20 underline-offset-4 hover:text-ink">
                {startedFromScratch ? "Start over" : "Upload a different PDF"}
              </button>

              <div className="w-full rounded-2xl border border-ink/10 bg-white/60 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-ink/40">Signature</p>
                <div className="mt-2 flex flex-col gap-2 text-sm">
                  <button type="button" onClick={() => setShowSignatureModal(true)} className="text-left text-accent hover:underline">
                    {signature.drawn ? "✓ Signature drawn — redraw" : "Draw a signature"}
                  </button>
                  <label className="cursor-pointer text-accent hover:underline">
                    {signature.uploaded ? "✓ Signature image uploaded — replace" : "Upload a signature image"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const bytes = new Uint8Array(await file.arrayBuffer());
                        setSignature((s) => ({ ...s, uploaded: bytes }));
                      }}
                    />
                  </label>
                </div>
              </div>

              <div className="w-full rounded-2xl border border-ink/10 bg-white/60 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-ink/40">Additional files</p>
                <p className="mt-1 text-xs text-ink/50">For merging or stamping — reference by name in your prompt.</p>
                <ul className="mt-2 space-y-1 text-sm">
                  {auxFiles.map((f) => (
                    <li key={f.id} className="text-ink/70">
                      {f.name} <span className="text-ink/35">({f.kind})</span>
                    </li>
                  ))}
                </ul>
                <label className="mt-2 inline-block cursor-pointer text-sm text-accent hover:underline">
                  + Add file
                  <input type="file" accept="application/pdf,image/png,image/jpeg" multiple className="hidden" onChange={(e) => handleAuxFiles(Array.from(e.target.files ?? []))} />
                </label>
              </div>
            </div>

            <div className="flex flex-col gap-5">
              {conversation.length > 0 && (
                <div className="grain-card flex flex-col gap-3 rounded-2xl p-4 shadow-card">
                  {conversation.map((m, i) => (
                    <p key={i} className={`text-sm ${m.role === "user" ? "text-ink" : "text-accent"}`}>
                      <span className="mr-2 text-xs font-medium uppercase tracking-wide opacity-50">{m.role === "user" ? "You" : "PromptPDF"}</span>
                      {m.content}
                    </p>
                  ))}
                </div>
              )}

              <PromptBox
                value={prompt}
                onChange={setPrompt}
                onSubmit={handleGeneratePlan}
                isLoading={isLoadingPlan}
                disabled={isExecuting}
              />
              <SuggestionChips onSelect={setPrompt} prompts={startedFromScratch ? CREATE_SUGGESTED_PROMPTS : SUGGESTED_PROMPTS} />

              {error && (
                <div className="rounded-2xl border border-clay/30 bg-clay/5 p-4 text-sm text-clay">{error}</div>
              )}

              {plan && !plan.clarificationNeeded && plan.operations.length > 0 && (
                <div className="flex flex-col gap-3">
                  <OperationLog title="Proposed plan" items={plan.operations.map(describeOperation)} tone="plan" />
                  <p className="text-sm text-ink/60">{plan.explanation}</p>
                  {warnings.length > 0 && (
                    <ul className="space-y-1 text-sm text-clay">
                      {warnings.map((w, i) => (
                        <li key={i}>⚠ {w}</li>
                      ))}
                    </ul>
                  )}
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleApply}
                      disabled={isExecuting || warnings.length > 0}
                      className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40"
                    >
                      {isExecuting ? "Applying…" : "Apply changes"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPlan(null)}
                      className="rounded-full border border-ink/15 px-5 py-2.5 text-sm hover:border-ink/30"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              )}

              {lastResultLog && (
                <div className="flex flex-col gap-3">
                  <OperationLog title="Done" items={lastResultLog} tone="result" />
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => download(fileBytes, fileName ?? "document.pdf")}
                      className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white"
                    >
                      Download PDF
                    </button>
                    {lastSplitOutputs?.map((part) => (
                      <button
                        key={part.name}
                        type="button"
                        onClick={() => download(part.bytes, part.name)}
                        className="rounded-full border border-ink/15 px-5 py-2.5 text-sm hover:border-ink/30"
                      >
                        Download {part.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
      <Footer />
      {showSignatureModal && (
        <SignatureModal
          onClose={() => setShowSignatureModal(false)}
          onSave={(bytes) => {
            setSignature((s) => ({ ...s, drawn: bytes }));
            setShowSignatureModal(false);
          }}
        />
      )}
    </div>
  );
}
