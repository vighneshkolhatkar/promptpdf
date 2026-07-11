export function Footer() {
  return (
    <footer className="mt-16 border-t border-ink/10">
      <div className="mx-auto max-w-5xl px-6 py-8 text-sm text-ink/50">
        <p>
          Your PDF is processed locally in your browser — only small text snippets (never the file itself) are sent to the
          language model to plan edits.
        </p>
        <p className="mt-2">Created by Vighnesh Kolhatkar.</p>
      </div>
    </footer>
  );
}
