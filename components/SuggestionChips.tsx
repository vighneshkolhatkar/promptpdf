export const SUGGESTED_PROMPTS = [
  "Rotate all pages 90° clockwise",
  "Add a diagonal watermark that says CONFIDENTIAL",
  "Add page numbers to the bottom center of every page",
  "Delete the last page",
  "Sign this document in the bottom-right of the first page",
  "Redact any text that says \"John Doe\"",
  "Highlight every mention of \"total due\"",
  "Extract pages 2 through 4 into a new PDF",
  "Compress this file to reduce its size",
];

export const CREATE_SUGGESTED_PROMPTS = [
  "A simple one-page resume for a software engineer",
  "A cover letter for a job application",
  "A one-page invoice with placeholder line items",
  "A flyer announcing a garage sale",
  "A basic meeting agenda",
];

interface SuggestionChipsProps {
  onSelect: (prompt: string) => void;
  prompts?: string[];
}

export function SuggestionChips({ onSelect, prompts = SUGGESTED_PROMPTS }: SuggestionChipsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {prompts.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onSelect(p)}
          className="rounded-full border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/70 transition-colors hover:border-accent/50 hover:text-ink"
        >
          {p}
        </button>
      ))}
    </div>
  );
}
