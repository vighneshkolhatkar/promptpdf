"use client";

import { useRef, useState } from "react";

interface SignatureModalProps {
  onSave: (pngBytes: Uint8Array) => void;
  onClose: () => void;
}

export function SignatureModal({ onSave, onClose }: SignatureModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasStroke, setHasStroke] = useState(false);

  const getContext = () => canvasRef.current?.getContext("2d") ?? null;

  const pointerPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    const ctx = getContext();
    if (!ctx) return;
    const { x, y } = pointerPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = getContext();
    if (!ctx) return;
    const { x, y } = pointerPos(e);
    ctx.lineTo(x, y);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1c1b19";
    ctx.stroke();
    setHasStroke(true);
  };

  const end = () => {
    drawing.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = getContext();
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStroke(false);
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      onSave(bytes);
    }, "image/png");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-redact/50 px-4">
      <div className="w-full max-w-md rounded-sm border border-rule bg-paper-raised p-6 shadow-page">
        <h2 className="font-serif text-xl italic">Draw your signature</h2>
        <p className="mt-1 font-mono text-xs text-graphite">Use your mouse, trackpad, or finger.</p>
        <canvas
          ref={canvasRef}
          width={400}
          height={160}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          className="mt-4 w-full touch-none rounded-sm border border-rule bg-paper"
        />
        <div className="mt-4 flex items-center justify-between">
          <button type="button" onClick={clear} className="font-mono text-xs text-graphite hover:text-ink">
            Clear
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-sm border border-rule px-4 py-2 font-mono text-[13px] hover:border-graphite"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!hasStroke}
              onClick={save}
              className="rounded-sm bg-pen px-4 py-2 font-mono text-[13px] font-semibold text-paper-raised disabled:opacity-40"
            >
              Save signature
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
