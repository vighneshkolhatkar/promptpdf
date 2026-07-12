export function Header() {
  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <div className="flex items-baseline gap-2.5">
          <span className="font-serif text-2xl italic tracking-tight">PromptPDF</span>
          <span className="hidden text-xs text-graphite sm:inline">edit PDFs by typing what you want</span>
        </div>
        <span
          className="select-none rounded-sm border-[1.5px] border-pen/70 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-pen"
          style={{ transform: "rotate(-2deg)" }}
          aria-label="Free, runs in your browser"
        >
          Free · in-browser
        </span>
      </div>
    </header>
  );
}
