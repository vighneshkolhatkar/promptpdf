import { z } from "zod";

// Runtime validation for whatever the LLM returns. Tool-calling constrains the
// *shape* the model is prompted to emit, but the model output is still
// untrusted input — nothing here is ever eval'd or executed as code, and
// anything that fails this schema is rejected before any operation runs.

const pageSelector = z.preprocess(
  // Defensive normalization: models occasionally emit ["all"] instead of
  // the bare string "all" — coerce it here rather than rejecting an
  // otherwise-valid plan over a trivial formatting slip.
  (val) => (Array.isArray(val) && val.length === 1 && val[0] === "all" ? "all" : val),
  z.union([
    z.literal("all"),
    z.object({ from: z.number().int().positive(), to: z.number().int().positive() }),
    z.array(z.number().int().positive()),
  ])
);

const position = z.union([
  z.enum([
    "top-left",
    "top-center",
    "top-right",
    "center",
    "bottom-left",
    "bottom-center",
    "bottom-right",
  ]),
  z.object({ xPct: z.number().min(0).max(100), yPct: z.number().min(0).max(100) }),
]);

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .optional();

const operationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create_blank_pdf"), pageCount: z.number().int().min(1).max(50), pageSize: z.enum(["letter", "a4"]).optional() }),
  z.object({ op: z.literal("rotate_pages"), pages: pageSelector, degrees: z.union([z.literal(90), z.literal(180), z.literal(270)]) }),
  z.object({ op: z.literal("delete_pages"), pages: pageSelector }),
  z.object({ op: z.literal("reorder_pages"), newOrder: z.array(z.number().int().positive()) }),
  z.object({ op: z.literal("extract_pages"), pages: pageSelector }),
  z.object({ op: z.literal("crop_pages"), pages: pageSelector, marginPct: z.number().min(0).max(45) }),
  z.object({
    op: z.literal("add_text"),
    pages: pageSelector,
    text: z.string().min(1).max(2000),
    position,
    fontSize: z.number().min(4).max(200).optional(),
    color: hexColor,
  }),
  z.object({
    op: z.literal("add_page_numbers"),
    position: position.optional(),
    startAt: z.number().int().optional(),
    format: z.string().max(64).optional(),
  }),
  z.object({
    op: z.literal("add_watermark"),
    text: z.string().min(1).max(200),
    pages: pageSelector.optional(),
    opacity: z.number().min(0).max(1).optional(),
    fontSize: z.number().min(4).max(400).optional(),
    color: hexColor,
    rotationDegrees: z.number().min(-180).max(180).optional(),
  }),
  z.object({
    op: z.literal("add_signature"),
    page: z.number().int().positive(),
    position,
    widthPct: z.number().min(1).max(100).optional(),
    signatureRef: z.enum(["drawn", "uploaded"]),
  }),
  z.object({
    op: z.literal("add_stamp_image"),
    page: z.number().int().positive(),
    position,
    widthPct: z.number().min(1).max(100).optional(),
    imageRef: z.string().min(1),
  }),
  z.object({
    op: z.literal("redact_text"),
    searchText: z.string().min(1).max(500),
    matchCase: z.boolean().optional(),
    pages: pageSelector.optional(),
  }),
  z.object({
    op: z.literal("highlight_text"),
    searchText: z.string().min(1).max(500),
    color: hexColor,
    pages: pageSelector.optional(),
  }),
  z.object({
    op: z.literal("fill_form_fields"),
    fields: z.array(z.object({ name: z.string().min(1), value: z.string() })).max(200),
    flatten: z.boolean().optional(),
  }),
  z.object({ op: z.literal("encrypt_pdf"), userPassword: z.string().min(1).max(200) }),
  z.object({ op: z.literal("merge_pdfs"), fileRefs: z.array(z.string()).min(1) }),
  z.object({
    op: z.literal("split_pdf"),
    ranges: z.array(z.object({ from: z.number().int().positive(), to: z.number().int().positive() })).min(1),
  }),
  z.object({ op: z.literal("compress_pdf"), imageQuality: z.number().min(0.1).max(1).optional() }),
]);

export const editPlanSchema = z.object({
  operations: z.array(operationSchema).max(20),
  explanation: z.string().max(2000),
  clarificationNeeded: z.string().max(1000).optional(),
});

export type ValidatedEditPlan = z.infer<typeof editPlanSchema>;

export function parseEditPlan(raw: unknown) {
  return editPlanSchema.safeParse(raw);
}
