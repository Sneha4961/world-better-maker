import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  createLovableAiGatewayRunIdFetch,
  GATEWAY_BASE,
  getLovableApiKey,
} from "./ai-gateway.server";

const AnalyzeInput = z.object({
  image: z
    .string()
    .min(64)
    .refine((v) => v.startsWith("data:image/"), "Expected an image data URL"),
});

const SpeakInput = z.object({
  text: z.string().min(1).max(1500),
});

const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    kind: {
      type: "string",
      enum: ["sign", "prescription", "menu", "document", "scene", "other"],
    },
    explanation: { type: "string" },
  },
  required: ["title", "kind", "explanation"],
} as const;

const SYSTEM_PROMPT = `You are Drishti, a friendly visual assistant for people with low vision, elderly users, and anyone who wants the world around them explained simply. The user photographs things: signs, prescriptions, menus, documents, screens, products, rooms.

Look carefully at the whole photo — any text, objects, colors and context. Then respond with:
- title: 2-5 words naming what the photo shows (e.g. "Pharmacy sign", "Café menu").
- kind: the best match of sign, prescription, menu, document, scene, other.
- explanation: 2-4 short, warm, plain-language sentences describing what is in the photo, what any visible text says, and what it means for the user. Use simple everyday words and short sentences — no jargon. If something important is visible (a dosage, a closing time, a price, a warning), mention it clearly. Write like you are gently describing it to a friend who cannot see well.`;

/** Reads the gateway's SSE stream and joins all output text deltas. */
async function readResponsesStream(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload);
        if (
          evt.type === "response.output_text.delta" &&
          typeof evt.delta === "string"
        ) {
          text += evt.delta;
        }
      } catch {
        // ignore malformed keep-alive lines
      }
    }
  }
  return text;
}

function parseResultJson(raw: string): {
  title: string;
  kind: string;
  explanation: string;
} {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("The photo could not be understood. Please try again.");
  }
  const parsed = JSON.parse(raw.slice(start, end + 1));
  return {
    title: String(parsed.title ?? "Scan"),
    kind: String(parsed.kind ?? "other"),
    explanation: String(parsed.explanation ?? ""),
  };
}

export const analyzeImage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => AnalyzeInput.parse(input))
  .handler(async ({ data }): Promise<{
    title: string;
    kind: string;
    explanation: string;
  }> => {
    const key = getLovableApiKey();
    const runIdFetch = createLovableAiGatewayRunIdFetch();

    const res = await runIdFetch.fetch(`${GATEWAY_BASE}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        stream: true,
        store: false,
        reasoning: { effort: "low", summary: "auto" },
        include: ["reasoning.encrypted_content"],
        text: {
          format: {
            type: "json_schema",
            name: "scan_result",
            schema: RESULT_SCHEMA,
          },
        },
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: SYSTEM_PROMPT },
              { type: "input_image", image_url: data.image },
            ],
          },
        ],
      }),
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Drishti couldn't look at that photo right now (${res.status}). ${detail.slice(0, 200)}`,
      );
    }

    const raw = await readResponsesStream(res);
    return parseResultJson(raw);
  });

export const speakText = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => SpeakInput.parse(input))
  .handler(
    async ({ data }): Promise<{ audio: string; mime: string }> => {
      const key = getLovableApiKey();

      const res = await fetch(`${GATEWAY_BASE}/audio/speech`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": key,
        },
        body: JSON.stringify({
          model: "google/gemini-3.1-flash-tts-preview",
          contents: [{ role: "user", parts: [{ text: data.text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
            },
          },
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(
          `Voice is unavailable right now (${res.status}). ${detail.slice(0, 200)}`,
        );
      }

      const buf = Buffer.from(await res.arrayBuffer());
      return {
        audio: buf.toString("base64"),
        mime: res.headers.get("content-type") ?? "audio/wav",
      };
    },
  );
