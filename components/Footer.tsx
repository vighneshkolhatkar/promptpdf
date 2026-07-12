export function Footer() {
  return (
    <footer className="mt-20 border-t border-rule">
      <div className="mx-auto max-w-5xl px-6 py-7 font-mono text-[11px] leading-relaxed text-graphite">
        <p>
          Your PDF is processed locally in your browser — only small text snippets (never the file itself) are sent to the
          language model to plan edits.
        </p>
        <p className="mt-1.5">Created by Vighnesh Kolhatkar.</p>
      </div>
    </footer>
  );
}
