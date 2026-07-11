export function Header() {
  return (
    <header className="border-b border-ink/10">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-2xl italic tracking-tight">PromptPDF</span>
          <span className="hidden text-sm text-ink/50 sm:inline">edit PDFs by typing what you want</span>
        </div>
        <span className="rounded-full border border-accent/30 bg-accentSoft px-3 py-1 text-xs font-medium text-accent">
          Free · runs in your browser
        </span>
      </div>
    </header>
  );
}
