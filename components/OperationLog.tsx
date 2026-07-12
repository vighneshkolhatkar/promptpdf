import type { Operation, PageSelector } from "@/lib/types";

function describePages(pages: PageSelector | undefined): string {
  if (!pages || pages === "all") return "all pages";
  if (Array.isArray(pages)) return `page(s) ${pages.join(", ")}`;
  return `pages ${pages.from}–${pages.to}`;
}

export function describeOperation(op: Operation): string {
  switch (op.op) {
    case "create_blank_pdf":
      return `Start a new blank ${op.pageCount}-page document (${op.pageSize ?? "letter"})`;
    case "rotate_pages":
      return `Rotate ${describePages(op.pages)} by ${op.degrees}°`;
    case "delete_pages":
      return `Delete ${describePages(op.pages)}`;
    case "reorder_pages":
      return `Reorder pages to: ${op.newOrder.join(", ")}`;
    case "extract_pages":
      return `Extract ${describePages(op.pages)} into a new file`;
    case "crop_pages":
      return `Crop ${describePages(op.pages)} by ${op.marginPct}% margin`;
    case "add_blank_pages":
      return `Add ${op.count} blank page(s) at the ${op.position ?? "end"} of the document`;
    case "add_text":
      return `Add text "${op.text}" to ${describePages(op.pages)}`;
    case "add_page_numbers":
      return `Add page numbers to every page`;
    case "add_watermark":
      return `Watermark ${describePages(op.pages)} with "${op.text}"`;
    case "add_signature":
      return `Place your signature on page ${op.page}`;
    case "add_stamp_image":
      return `Place an image stamp on page ${op.page}`;
    case "redact_text":
      return `Permanently redact "${op.searchText}" from ${describePages(op.pages)}`;
    case "highlight_text":
      return `Highlight "${op.searchText}" in ${describePages(op.pages)}`;
    case "fill_form_fields":
      return `Fill ${op.fields.length} form field(s)${op.flatten ? " and lock them" : ""}`;
    case "merge_pdfs":
      return `Merge in ${op.fileRefs.length} additional file(s)`;
    case "split_pdf":
      return `Split into ${op.ranges.length} file(s)`;
    case "compress_pdf":
      return `Compress images in the file`;
    default: {
      const _exhaustive: never = op;
      return `Unknown operation: ${JSON.stringify(_exhaustive)}`;
    }
  }
}

interface OperationLogProps {
  title: string;
  items: string[];
  tone?: "plan" | "result";
}

export function OperationLog({ title, items, tone = "plan" }: OperationLogProps) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-sm border border-rule bg-paper-raised p-4 shadow-page">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-graphite">{title}</p>
      <ul className="mt-2.5 space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 font-mono text-[13px] leading-snug text-ink">
            <span className={tone === "plan" ? "text-pen" : "text-graphite"}>{tone === "plan" ? "→" : "✓"}</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
