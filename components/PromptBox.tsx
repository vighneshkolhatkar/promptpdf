"use client";

interface PromptBoxProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  isLoading?: boolean;
}

export function PromptBox({ value, onChange, onSubmit, disabled, isLoading }: PromptBoxProps) {
  return (
    <div className="rounded-sm border border-rule border-l-[3px] border-l-pen bg-paper-raised p-4 shadow-page">
      <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-pen">Your instruction</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder="Rotate all pages and add a CONFIDENTIAL watermark…"
        rows={3}
        disabled={disabled}
        className="w-full resize-none border-none bg-transparent font-mono text-[15px] leading-relaxed text-ink outline-none placeholder:text-graphite/60 disabled:opacity-50"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="font-mono text-[11px] text-graphite">⌘/Ctrl + Enter to submit</span>
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || isLoading || value.trim().length === 0}
          className="rounded-sm bg-pen px-5 py-2 font-mono text-[13px] font-semibold text-paper-raised transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {isLoading ? "Thinking…" : "Generate plan"}
        </button>
      </div>
    </div>
  );
}
