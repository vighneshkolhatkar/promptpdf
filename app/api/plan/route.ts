import { NextRequest, NextResponse } from "next/server";
import Groq, { BadRequestError, RateLimitError } from "groq-sdk";
import { SYSTEM_PROMPT, submitEditPlanTool } from "@/lib/llmTools";
import { parseEditPlan } from "@/lib/planSchema";
import { planRequestSchema } from "@/lib/requestSchema";
import { estimateTokens, buildMessagesForBudget } from "@/lib/promptBudget";

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

  const groq = new Groq({ apiKey });

  // Groq's free tier caps tokens *per day, per model* — under real
  // multi-user load the primary model can run dry well before the day is
  // over. Each model on the account draws from its own separate quota, so
  // falling through this list on ANY failure for a given model (API errors,
  // a truncated generation, a missing/malformed tool call, output that
  // fails our schema — not just rate limits, since a lesser-tested fallback
  // model occasionally hiccupping is exactly what another model in the
  // chain should paper over) pools all their daily budgets together instead
  // of being capped by whichever is smallest. Ordered best-quality-first;
  // every entry here is confirmed to support tool use on Groq
  // (https://console.groq.com/docs/tool-use). tpm/maxTokens come from
  // https://console.groq.com/docs/rate-limits — tpm is the per-model
  // tokens-per-minute cap (which Groq counts against the WHOLE request:
  // prompt + reserved max_tokens), used below to size how much
  // conversation/document context each model actually gets sent, since the
  // smallest models here can't fit nearly as much as the largest:
  //   llama-3.3-70b-versatile            100K TPD /  12K TPM
  //   llama-4-scout-17b-16e-instruct     500K TPD /  30K TPM
  //   openai/gpt-oss-120b                200K TPD /   8K TPM
  //   qwen/qwen3-32b                     500K TPD /   6K TPM
  //   openai/gpt-oss-20b                 200K TPD /   8K TPM
  //   qwen3.6-27b                        200K TPD /   8K TPM
  //   llama-3.1-8b-instant               500K TPD /   6K TPM  (smallest
  //                                       model, but by far the highest
  //                                       request/day cap — last-resort
  //                                       safety net)
  // Deliberately excluded despite being enabled on the account:
  // groq/compound(-mini) (only 250 requests/day, and an agentic system that
  // can invoke its own built-in tools alongside ours — unpredictable with a
  // forced custom tool schema), openai/gpt-oss-safeguard-20b (a
  // content-moderation classifier, not a general instruction-following
  // model), and allam-2-7b (not confirmed to support tool use at all).
  // maxTokens is tuned per model's tpm, not a single global value — the
  // fixed system-prompt/tool-schema overhead alone (see below) already
  // consumes a big share of the smallest models' budgets, so a uniformly
  // generous max_tokens (this used to be a flat 6144 for every model) left
  // the 6K/8K-TPM models almost no room for any document content at all.
  const MODEL_FALLBACK_CHAIN: { model: string; tpm: number; maxTokens: number }[] = [
    { model: "llama-3.3-70b-versatile", tpm: 12_000, maxTokens: 4096 },
    { model: "meta-llama/llama-4-scout-17b-16e-instruct", tpm: 30_000, maxTokens: 4096 },
    { model: "openai/gpt-oss-120b", tpm: 8_000, maxTokens: 2000 },
    { model: "qwen/qwen3-32b", tpm: 6_000, maxTokens: 1200 },
    { model: "openai/gpt-oss-20b", tpm: 8_000, maxTokens: 2000 },
    { model: "qwen/qwen3.6-27b", tpm: 8_000, maxTokens: 2000 },
    { model: "llama-3.1-8b-instant", tpm: 6_000, maxTokens: 1200 },
  ];

  // The system prompt and tool schema are sent unchanged to every model —
  // this is the token floor every model's budget has to clear before any
  // conversation/document content fits at all.
  const FIXED_OVERHEAD_TOKENS = estimateTokens(SYSTEM_PROMPT) + estimateTokens(JSON.stringify(submitEditPlanTool));

  // Everything that can go wrong with a single model's response — API
  // errors, a truncated generation, a missing/malformed tool call, or
  // output that fails our schema — falls through to the next model in the
  // chain rather than failing the request outright. A less-tested fallback
  // model occasionally producing a bad tool call is exactly the kind of
  // hiccup another model in the chain can paper over, and the whole point
  // of the chain is to keep the user unblocked whenever there's any healthy
  // model left to try.
  let lastErrorResponse: NextResponse | null = null;
  for (let i = 0; i < MODEL_FALLBACK_CHAIN.length; i++) {
    const { model, tpm, maxTokens } = MODEL_FALLBACK_CHAIN[i];

    // Compact conversation history and document context to whatever fits
    // in this model's remaining budget after the fixed system prompt/tool
    // schema and the reply's own reserved max_tokens. If even the most
    // aggressive compaction (latest turn only, no text preview) doesn't
    // fit, this model structurally cannot serve this request — skip it
    // without spending a round-trip on a guaranteed rejection.
    const conversation = buildMessagesForBudget(messages, documentContext, tpm - FIXED_OVERHEAD_TOKENS - maxTokens);
    if (!conversation) {
      console.error(`[/api/plan] skipping model=${model} — request doesn't fit its ${tpm} TPM budget even fully compacted`);
      lastErrorResponse ??= NextResponse.json(
        { error: "This document/conversation is too large for the planning service right now. Try a shorter request or a smaller document." },
        { status: 413 }
      );
      continue;
    }

    let completion;
    try {
      completion = await groq.chat.completions.create({
        model,
        temperature: 0.1,
        max_tokens: maxTokens,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...conversation],
        tools: [submitEditPlanTool],
        tool_choice: { type: "function", function: { name: "submit_edit_plan" } },
      });
    } catch (err) {
      console.error(`[/api/plan] Groq API call failed (model=${model}):`, err);
      lastErrorResponse = NextResponse.json(
        err instanceof RateLimitError
          ? { error: "PromptPDF is getting a lot of use right now and has hit its free daily AI limit. Please try again later." }
          // Occasionally the model emits a tool call that Groq's own strict
          // schema check rejects (e.g. a minor formatting slip in one
          // field, or a model-specific context-window overflow). That's a
          // model hiccup, not something the user did wrong or needs to see
          // a raw API dump about.
          : { error: "The model produced a plan in an unexpected format. Please try again — rephrasing slightly can help." },
        { status: 502 }
      );
      continue;
    }

    const choice = completion.choices[0];
    if (choice?.finish_reason === "length") {
      // Hit max_tokens mid-generation — the JSON is very likely incomplete.
      // Don't attempt to "repair" and execute a guessed-at plan against a
      // real file; a wrong guess here means a silently wrong edit.
      console.error(`[/api/plan] generation truncated at max_tokens (model=${model})`);
      lastErrorResponse = NextResponse.json(
        { error: "That request needed a longer response than allowed. Try breaking it into smaller steps." },
        { status: 502 }
      );
      continue;
    }

    const toolCall = choice?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== "submit_edit_plan") {
      lastErrorResponse = NextResponse.json(
        { error: "The model did not return a usable edit plan. Try rephrasing your request." },
        { status: 502 }
      );
      continue;
    }

    let rawArgs: unknown;
    try {
      rawArgs = JSON.parse(toolCall.function.arguments);
    } catch {
      lastErrorResponse = NextResponse.json({ error: "The model returned malformed plan data." }, { status: 502 });
      continue;
    }

    const parsed = parseEditPlan(rawArgs);
    if (!parsed.success) {
      console.error(`[/api/plan] LLM output failed schema validation (model=${model}):`, parsed.error.flatten());
      lastErrorResponse = NextResponse.json(
        { error: "The model's plan didn't match the allowed operation schema. Please try again." },
        { status: 502 }
      );
      continue;
    }

    return NextResponse.json(parsed.data);
  }

  return lastErrorResponse ?? NextResponse.json({ error: "Could not reach the planning service. Please try again shortly." }, { status: 502 });
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
