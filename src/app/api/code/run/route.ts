import { runNativeCode } from "@/lib/native-code-runner";
import type { NativeCodeLanguage } from "@/lib/code-runner";

export const runtime = "nodejs";
export const maxDuration = 30;

function isNativeLanguage(value: unknown): value is NativeCodeLanguage {
  return value === "c" || value === "cpp";
}

export async function POST(request: Request) {
  let body: { language?: unknown; code?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!isNativeLanguage(body.language)) {
    return Response.json({ error: "Language must be C or C++." }, { status: 400 });
  }
  if (typeof body.code !== "string" || !body.code.trim() || body.code.length > 30_000) {
    return Response.json({ error: "Code must be between 1 and 30,000 characters." }, { status: 400 });
  }

  return Response.json(await runNativeCode(body.language, body.code), {
    headers: { "Cache-Control": "no-store" },
  });
}