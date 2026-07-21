import {
  createTutoringSession,
  deleteTutoringSession,
  getTutoringSession,
  listTutoringSessions,
  renameTutoringSession,
  replaceSessionTranscript,
  searchSessionTranscripts,
  touchTutoringSession,
} from "@/lib/session-db";
import type { TranscriptEntry } from "@/lib/session-types";

export const runtime = "nodejs";

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,128}$/.test(value);
}

function validTitle(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 120;
}

function parseTranscript(value: unknown): TranscriptEntry[] | null {
  if (!Array.isArray(value) || value.length > 500) return null;
  const entries: TranscriptEntry[] = [];
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      !validId("id" in item ? item.id : null) ||
      !("role" in item && (item.role === "learner" || item.role === "professor")) ||
      !("text" in item && typeof item.text === "string" && item.text.length <= 20_000) ||
      !("createdAt" in item && typeof item.createdAt === "number")
    ) {
      return null;
    }
    entries.push({
      id: item.id,
      role: item.role,
      text: item.text,
      createdAt: item.createdAt,
    });
  }
  return entries;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim();
  if (query) {
    return Response.json({ results: searchSessionTranscripts(query) });
  }
  return Response.json({ sessions: listTutoringSessions() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { id?: unknown; title?: unknown };
  if (!validId(body.id) || !validTitle(body.title)) {
    return Response.json({ error: "Invalid session." }, { status: 400 });
  }
  if (getTutoringSession(body.id)) {
    return Response.json({ error: "Session already exists." }, { status: 409 });
  }
  return Response.json({ session: createTutoringSession(body.id, body.title.trim()) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as {
    id?: unknown;
    title?: unknown;
    transcript?: unknown;
    touch?: unknown;
  };
  if (!validId(body.id) || !getTutoringSession(body.id)) {
    return Response.json({ error: "Session not found." }, { status: 404 });
  }
  if (body.title !== undefined) {
    if (!validTitle(body.title)) return Response.json({ error: "Invalid title." }, { status: 400 });
    renameTutoringSession(body.id, body.title.trim());
  }
  if (body.transcript !== undefined) {
    const transcript = parseTranscript(body.transcript);
    if (!transcript) return Response.json({ error: "Invalid transcript." }, { status: 400 });
    replaceSessionTranscript(body.id, transcript);
  }
  if (body.touch === true) touchTutoringSession(body.id);
  return Response.json({ session: getTutoringSession(body.id) });
}

export async function DELETE(request: Request) {
  const body = (await request.json()) as { id?: unknown };
  if (!validId(body.id)) return Response.json({ error: "Invalid session ID." }, { status: 400 });
  deleteTutoringSession(body.id);
  return new Response(null, { status: 204 });
}