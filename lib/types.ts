// The whitelist of PDF operations the LLM is allowed to request.
// The model never emits code — only these typed, parameter-validated ops.

export type PageSelector =
  | "all"
  | { from: number; to: number } // 1-indexed, inclusive
  | number[]; // explicit 1-indexed page numbers

export type Position =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"
  | { xPct: number; yPct: number }; // 0-100; xPct from the left, yPct from the TOP (natural reading order — flipped to PDF's bottom-origin space internally)

export interface OpCreateBlankPdf {
  op: "create_blank_pdf";
  pageCount: number;
  pageSize?: "letter" | "a4";
}

export interface OpRotatePages {
  op: "rotate_pages";
  pages: PageSelector;
  degrees: 90 | 180 | 270;
}

export interface OpDeletePages {
  op: "delete_pages";
  pages: PageSelector;
}

export interface OpReorderPages {
  op: "reorder_pages";
  newOrder: number[]; // 1-indexed original page numbers in desired order
}

export interface OpExtractPages {
  op: "extract_pages";
  pages: PageSelector;
}

export interface OpCropPages {
  op: "crop_pages";
  pages: PageSelector;
  marginPct: number; // shrink each side by this % of page dimension
}

export interface OpAddText {
  op: "add_text";
  pages: PageSelector;
  text: string;
  position: Position;
  fontSize?: number;
  color?: string; // hex, e.g. "#111318"
}

export interface OpAddPageNumbers {
  op: "add_page_numbers";
  position?: Position;
  startAt?: number;
  format?: string; // e.g. "Page {n} of {total}"
}

export interface OpAddWatermark {
  op: "add_watermark";
  text: string;
  pages?: PageSelector;
  opacity?: number; // 0-1
  fontSize?: number;
  color?: string;
  rotationDegrees?: number;
}

export interface OpAddSignature {
  op: "add_signature";
  page: number; // 1-indexed
  position: Position;
  widthPct?: number; // width as % of page width
  signatureRef: "drawn" | "uploaded"; // which signature asset to use
}

export interface OpAddStampImage {
  op: "add_stamp_image";
  page: number;
  position: Position;
  widthPct?: number;
  imageRef: string; // id of an uploaded auxiliary image asset
}

export interface OpRedactText {
  op: "redact_text";
  searchText: string;
  matchCase?: boolean;
  pages?: PageSelector;
}

export interface OpHighlightText {
  op: "highlight_text";
  searchText: string;
  color?: string;
  pages?: PageSelector;
}

export interface OpFillFormFields {
  op: "fill_form_fields";
  fields: { name: string; value: string }[];
  flatten?: boolean;
}

export interface OpMergePdfs {
  op: "merge_pdfs";
  fileRefs: string[]; // ids of additional uploaded PDFs, in merge order
}

export interface OpSplitPdf {
  op: "split_pdf";
  ranges: { from: number; to: number }[];
}

export interface OpCompressPdf {
  op: "compress_pdf";
  imageQuality?: number; // 0-1, JPEG quality for re-encoded images
}

export type Operation =
  | OpCreateBlankPdf
  | OpRotatePages
  | OpDeletePages
  | OpReorderPages
  | OpExtractPages
  | OpCropPages
  | OpAddText
  | OpAddPageNumbers
  | OpAddWatermark
  | OpAddSignature
  | OpAddStampImage
  | OpRedactText
  | OpHighlightText
  | OpFillFormFields
  | OpMergePdfs
  | OpSplitPdf
  | OpCompressPdf;

export interface EditPlan {
  operations: Operation[];
  explanation: string;
  clarificationNeeded?: string;
}

// "pdf"/"image" are usable by their raw bytes (merge_pdfs, add_stamp_image
// respectively); "docx"/"text" are readable only as extracted text — a
// source of data for fill_form_fields/add_text, never mergeable or
// stampable. A pdf can be both bytes-usable and (via textPreview below) a
// text data source at once.
export type AuxFileKind = "pdf" | "image" | "docx" | "text";

export interface DocumentContext {
  pageCount: number;
  pageSizes: { width: number; height: number }[];
  textPreview: string; // truncated, per-page-tagged text
  formFields: { name: string; type: string }[];
  hasAuxiliaryFiles: { id: string; name: string; kind: AuxFileKind; textPreview?: string }[];
  availableSignatures: { drawn: boolean; uploaded: boolean };
}

// A running exchange with the planner. Kept client-side and resent in full
// on every /api/plan call so a clarification question doesn't dead-end the
// interaction — the user's next message is treated as an answer within the
// same conversation rather than a brand-new, context-free request.
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
