import { NextRequest, NextResponse } from "next/server";
import Groq, { BadRequestError } from "groq-sdk";
import { SYSTEM_PROMPT, submitEditPlanTool } from "@/lib/llmTools";
import { parseEditPlan } from "@/lib/planSchema";
import { planRequestSchema } from "@/lib/requestSchema";

export const runtime = "nodejs";

// Free-tier-friendly, in-memory rate limit. This resets whenever the
// serverless function cold-starts, so it's a soft speed bump against
// accidental abuse (e.g. a runaway retry loop) rather than a hard guarantee —
// intentionally simple since there's no database or paid service in this
// project to back a real rate limiter.
const REQUESTS_PER_WINDOW = 20;
const WINDOW_MS = 10 * 60 * 1000;
const requestLog = new Map<string, number[]>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const timestamps = (requestLog.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  timestamps.push(now);
  requestLog.set(key, timestamps);
  return timestamps.length > REQUESTS_PER_WINDOW;
}

// Belt-and-suspenders cap on raw request size, checked before JSON.parse —
// the zod schema below already bounds every field individually, but this
// rejects an oversized payload cheaply without paying for a parse first.
const MAX_BODY_BYTES = 300_000;

function clientIp(req: NextRequest): string {
  // Trustworthy on Vercel specifically: their edge network sets/overwrites
  // x-forwarded-for itself, so a client can't spoof it there. Self-hosting
  // behind a different proxy would need the same guarantee re-verified.
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

async function handlePost(req: NextRequest): Promise<NextResponse> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is missing GROQ_API_KEY. Get a free key at https://console.groq.com/keys and set it in your environment." },
      { status: 500 }
    );
  }

  if (isRateLimited(clientIp(req))) {
    return NextResponse.json({ error: "Too many requests. Please wait a few minutes and try again." }, { status: 429 });
  }

  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request body too large." }, { status: 413 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const bodyResult = planRequestSchema.safeParse(parsedJson);
  if (!bodyResult.success) {
    // The shape of our own validation schema isn't something a client needs
    // (or should be encouraged to probe) — log it for us, keep the response
    // generic.
    console.error("[/api/plan] request validation failed:", bodyResult.error.flatten());
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { messages, documentContext } = bodyResult.data;
  const { drawn, uploaded } = documentContext.availableSignatures;
  const signatureLine = drawn && uploaded
    ? 'Signature: both a drawn signature and an uploaded signature image are available. Prefer signatureRef "uploaded" unless the user says otherwise.'
    : drawn
      ? 'Signature: a drawn signature is available. Use signatureRef "drawn".'
      : uploaded
        ? 'Signature: an uploaded signature image is available. Use signatureRef "uploaded".'
        : "Signature: none provided yet. If the user asks to sign the document, set clarificationNeeded asking them to draw or upload a signature first.";

  const contextSummary = [
    `Page count: ${documentContext.pageCount}`,
    documentContext.formFields.length > 0
      ? `Form fields: ${documentContext.formFields.map((f) => `${f.name} (${f.type})`).join(", ")}`
      : "Form fields: none",
    documentContext.hasAuxiliaryFiles.length > 0
      ? `Additional uploaded files available: ${documentContext.hasAuxiliaryFiles.map((f) => `${f.id}=${f.name} (${f.kind})`).join(", ")}`
      : "No additional files uploaded.",
    signatureLine,
    "Extracted text preview (may be truncated):",
    documentContext.textPreview || "(no extractable text — likely a scanned/image-only PDF)",
  ].join("\n");

  // Fold the (always-current) document context into the latest user turn
  // only, rather than as its own leading message — keeps strict user/
  // assistant alternation intact while still reflecting anything that
  // changed since earlier turns (e.g. a file uploaded mid-conversation).
  const conversation = messages.map((m, i) =>
    i === messages.length - 1 && m.role === "user"
      ? { role: "user" as const, content: `Document context:\n${contextSummary}\n\nUser request: ${m.content}` }
      : { role: m.role, content: m.content }
  );

  const groq = new Groq({ apiKey });

  let completion;
  try {
    completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0.1,
      // Generous enough for a full 20-operation plan with multi-paragraph
      // add_text content (the from-scratch document creation case), but
      // bounded rather than left open-ended.
      max_tokens: 4096,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...conversation],
      tools: [submitEditPlanTool],
      tool_choice: { type: "function", function: { name: "submit_edit_plan" } },
    });
  } catch (err) {
    console.error("[/api/plan] Groq API call failed:", err);
    // Occasionally the model emits a tool call that Groq's own strict
    // schema check rejects (e.g. a minor formatting slip in one field).
    // That's a model hiccup, not something the user did wrong or needs to
    // see a raw API dump about — ask them to retry rather than exposing it.
    if (err instanceof BadRequestError) {
      return NextResponse.json(
        { error: "The model produced a plan in an unexpected format. Please try again — rephrasing slightly can help." },
        { status: 502 }
      );
    }
    return NextResponse.json({ error: "Could not reach the planning service. Please try again shortly." }, { status: 502 });
  }

  const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.function.name !== "submit_edit_plan") {
    return NextResponse.json({ error: "The model did not return a usable edit plan. Try rephrasing your request." }, { status: 502 });
  }

  let rawArgs: unknown;
  try {
    rawArgs = JSON.parse(toolCall.function.arguments);
  } catch {
    return NextResponse.json({ error: "The model returned malformed plan data." }, { status: 502 });
  }

  const parsed = parseEditPlan(rawArgs);
  if (!parsed.success) {
    console.error("[/api/plan] LLM output failed schema validation:", parsed.error.flatten());
    return NextResponse.json({ error: "The model's plan didn't match the allowed operation schema. Please try again." }, { status: 502 });
  }

  return NextResponse.json(parsed.data);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    return await handlePost(req);
  } catch (err) {
    // Final safety net — never let an unexpected exception surface a stack
    // trace or internal detail to the client.
    console.error("[/api/plan] unhandled error:", err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
