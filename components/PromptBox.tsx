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
    <div className="grain-card rounded-2xl p-4 shadow-card">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder="Tell me what to do with this PDF — e.g. “Rotate all pages and add a CONFIDENTIAL watermark”"
        rows={3}
        disabled={disabled}
        className="w-full resize-none border-none bg-transparent text-base outline-none placeholder:text-ink/35 disabled:opacity-50"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-ink/35">⌘/Ctrl + Enter to submit</span>
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || isLoading || value.trim().length === 0}
          className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
        >
          {isLoading ? "Thinking…" : "Generate plan"}
        </button>
      </div>
    </div>
  );
}
