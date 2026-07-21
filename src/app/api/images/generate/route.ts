import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 120;

const ALLOWED_SIZES = new Set(["1024x1024", "1536x1024", "1024x1536"]);
const ALLOWED_QUALITIES = new Set(["low", "medium", "high"]);

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Image generation is not configured." }, { status: 503 });
  }

  let body: { prompt?: unknown; size?: unknown; quality?: unknown; sessionId?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || prompt.length > 4_000) {
    return Response.json({ error: "Image prompt must be between 1 and 4,000 characters." }, { status: 400 });
  }

  const size = typeof body.size === "string" && ALLOWED_SIZES.has(body.size) ? body.size : "1024x1024";
  const quality =
    typeof body.quality === "string" && ALLOWED_QUALITIES.has(body.quality) ? body.quality : "low";
  const sessionId =
    typeof body.sessionId === "string" && body.sessionId.length <= 128 ? body.sessionId : "anonymous";

  try {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": createHash("sha256").update(sessionId).digest("hex"),
      },
      body: JSON.stringify({
        model: "gpt-image-2",
        prompt,
        n: 1,
        size,
        quality,
        output_format: "jpeg",
        output_compression: 85,
        moderation: "auto",
      }),
    });

    const payload = (await response.json()) as {
      data?: Array<{ b64_json?: string; revised_prompt?: string }>;
      error?: { code?: string; message?: string };
    };
    const image = payload.data?.[0];

    if (!response.ok || !image?.b64_json) {
      const blocked = payload.error?.code === "moderation_blocked";
      return Response.json(
        {
          error: blocked
            ? "The image request could not be completed. Try a neutral visual description."
            : payload.error?.message ?? "OpenAI could not generate the image.",
        },
        { status: response.status || 502 },
      );
    }

    return Response.json(
      {
        dataUrl: `data:image/jpeg;base64,${image.b64_json}`,
        revisedPrompt: image.revised_prompt ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "Could not reach the OpenAI Image API." }, { status: 502 });
  }
}