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
    ctx.strokeStyle = "#111318";
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4">
      <div className="grain-card w-full max-w-md rounded-2xl p-6 shadow-card">
        <h2 className="font-serif text-xl italic">Draw your signature</h2>
        <p className="mt-1 text-sm text-ink/50">Use your mouse, trackpad, or finger.</p>
        <canvas
          ref={canvasRef}
          width={400}
          height={160}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          className="mt-4 w-full touch-none rounded-lg border border-ink/15 bg-white"
        />
        <div className="mt-4 flex items-center justify-between">
          <button type="button" onClick={clear} className="text-sm text-ink/50 hover:text-ink">
            Clear
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-ink/15 px-4 py-2 text-sm hover:border-ink/30"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!hasStroke}
              onClick={save}
              className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              Save signature
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
