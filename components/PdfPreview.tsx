"use client";

import { useEffect, useRef, useState } from "react";
import { loadPdfDocument } from "@/lib/pdfContext";

interface PdfPreviewProps {
  bytes: Uint8Array | null;
  label: string;
  /** Which page to jump to whenever `bytes` changes (e.g. the page an edit actually landed on). Defaults to 1. */
  initialPage?: number;
}

export function PdfPreview({ bytes, label, initialPage }: PdfPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(initialPage ?? 1);

  // Jump to the relevant page whenever the underlying file changes (a new
  // upload, or a freshly applied edit) — without this, the preview kept
  // showing page 1 even when the only change was on a different page (e.g.
  // a signature placed on the last page), which looked like the preview
  // wasn't updating at all. Reset during render (React's documented pattern
  // for "adjusting state when a prop changes") rather than in an effect, so
  // it doesn't cost an extra render pass.
  const [prevBytes, setPrevBytes] = useState(bytes);
  if (bytes !== prevBytes) {
    setPrevBytes(bytes);
    setCurrentPage(initialPage ?? 1);
    setError(null);
  }

  useEffect(() => {
    if (!bytes) return;
    let cancelled = false;
    let renderTask: { promise: Promise<void>; cancel: () => void } | null = null;

    (async () => {
      try {
        const doc = await loadPdfDocument(bytes);
        if (cancelled) return;
        setPageCount(doc.numPages);
        const pageNum = Math.min(Math.max(currentPage, 1), doc.numPages);
        const page = await doc.getPage(pageNum);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: 1 });
        const targetWidth = 280;
        const scale = targetWidth / viewport.width;
        const scaledViewport = page.getViewport({ scale });

        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = scaledViewport.width;
        canvas.height = scaledViewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        // pdf.js throws if a second render() starts on the same canvas
        // before the previous one finishes — e.g. when `bytes` or
        // `currentPage` changes again while a prior render is still in
        // flight. Track the task so the cleanup below can cancel it
        // instead of leaving a stale frame on screen.
        renderTask = page.render({ canvasContext: ctx, viewport: scaledViewport, canvas });
        await renderTask.promise;
        if (!cancelled) setError(null);
      } catch (e) {
        const isCancellation = e instanceof Error && e.name === "RenderingCancelledException";
        if (!cancelled && !isCancellation) setError(e instanceof Error ? e.message : "Could not render preview.");
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [bytes, currentPage]);

  if (!bytes) return null;

  return (
    <div className="flex flex-col items-center gap-3 rounded-sm bg-paper-raised p-4 shadow-page">
      <canvas ref={canvasRef} className="border border-rule" />
      {error && <p className="font-mono text-xs text-pen">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          disabled={currentPage <= 1}
          aria-label="Previous page"
          className="text-graphite hover:text-ink disabled:opacity-25"
        >
          ‹
        </button>
        <p className="font-mono text-[11px] text-graphite">
          {label}
          {pageCount ? ` · page ${Math.min(Math.max(currentPage, 1), pageCount)} of ${pageCount}` : ""}
        </p>
        <button
          type="button"
          onClick={() => setCurrentPage((p) => Math.min(pageCount ?? p, p + 1))}
          disabled={!pageCount || currentPage >= pageCount}
          aria-label="Next page"
          className="text-graphite hover:text-ink disabled:opacity-25"
        >
          ›
        </button>
      </div>
    </div>
  );
}
