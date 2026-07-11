import { z } from "zod";

// Validates the incoming /api/plan request body — untrusted client input,
// distinct from lib/planSchema.ts which validates the LLM's response. Caps
// are generous for real usage but block a client (malicious or buggy) from
// sending payloads large enough to blow up Groq token costs, exceed model
// context limits, or just waste the free-tier rate limit budget.

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});

const documentContextSchema = z.object({
  pageCount: z.number().int().min(0).max(10000),
  pageSizes: z.array(z.object({ width: z.number(), height: z.number() })).max(10000),
  textPreview: z.string().max(20000),
  formFields: z.array(z.object({ name: z.string().max(500), type: z.string().max(100) })).max(500),
  hasAuxiliaryFiles: z
    .array(z.object({ id: z.string().max(200), name: z.string().max(500), kind: z.enum(["pdf", "image"]) }))
    .max(50),
  availableSignatures: z.object({ drawn: z.boolean(), uploaded: z.boolean() }),
});

export const planRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1).max(40),
  documentContext: documentContextSchema,
});

export type PlanRequest = z.infer<typeof planRequestSchema>;
