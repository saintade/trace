import { createHash } from "node:crypto";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Voice is not configured. Add OPENAI_API_KEY to your environment." },
      { status: 503 },
    );
  }

  let sessionId = "anonymous";
  try {
    const body = (await request.json()) as { sessionId?: unknown };
    if (typeof body.sessionId === "string" && body.sessionId.length <= 128) {
      sessionId = body.sessionId;
    }
  } catch {
    // A missing body is valid; the request still receives an anonymous safety identifier.
  }

  const safetyIdentifier = createHash("sha256").update(sessionId).digest("hex");

  try {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": safetyIdentifier,
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: "gpt-realtime-2.1",
          audio: { output: { voice: "marin" } },
        },
      }),
    });

    const payload = (await response.json()) as {
      value?: string;
      expires_at?: number;
      error?: { message?: string };
    };

    if (!response.ok || !payload.value) {
      return Response.json(
        { error: payload.error?.message ?? "OpenAI could not create a Realtime session." },
        { status: response.status || 502 },
      );
    }

    return Response.json(
      { value: payload.value, expiresAt: payload.expires_at ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Could not reach the OpenAI Realtime API." },
      { status: 502 },
    );
  }
}