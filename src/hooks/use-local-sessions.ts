"use client";

import { useEffect, useRef, useState } from "react";
import type { TranscriptEntry, TutoringSession } from "@/lib/session-types";

const ACTIVE_SESSION_KEY = "trace-active-tutoring-session";

function defaultSessionTitle() {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
}

export function useLocalSessions() {
  const [sessions, setSessions] = useState<TutoringSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const transcriptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function createSession(title = defaultSessionTitle()) {
    const id = crypto.randomUUID();
    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title }),
    });
    if (!response.ok) throw new Error("Could not create a local session.");
    const result = (await response.json()) as { session: TutoringSession };
    setSessions((current) => [result.session, ...current]);
    setActiveSessionId(result.session.id);
    localStorage.setItem(ACTIVE_SESSION_KEY, result.session.id);
    return result.session;
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/sessions", { cache: "no-store" });
        const result = (await response.json()) as { sessions: TutoringSession[] };
        if (cancelled) return;
        setSessions(result.sessions);
        const preferredId = localStorage.getItem(ACTIVE_SESSION_KEY);
        const active = result.sessions.find((session) => session.id === preferredId) ?? result.sessions[0];
        if (active) {
          setActiveSessionId(active.id);
          localStorage.setItem(ACTIVE_SESSION_KEY, active.id);
          void fetch("/api/sessions", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: active.id, touch: true }),
          });
        } else {
          await createSession();
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function openSession(id: string) {
    setActiveSessionId(id);
    localStorage.setItem(ACTIVE_SESSION_KEY, id);
    setSessions((current) => {
      const now = Date.now();
      return current
        .map((session) => (session.id === id ? { ...session, lastOpenedAt: now } : session))
        .sort((first, second) => second.lastOpenedAt - first.lastOpenedAt);
    });
    void fetch("/api/sessions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, touch: true }),
    });
  }

  async function renameSession(id: string, title: string) {
    const normalized = title.trim().slice(0, 120);
    if (!normalized) return;
    const response = await fetch("/api/sessions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title: normalized }),
    });
    if (!response.ok) return;
    const result = (await response.json()) as { session: TutoringSession };
    setSessions((current) => current.map((session) => (session.id === id ? result.session : session)));
  }

  async function deleteSession(id: string) {
    await fetch("/api/sessions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const remaining = sessions.filter((session) => session.id !== id);
    setSessions(remaining);
    if (activeSessionId === id) {
      if (remaining[0]) openSession(remaining[0].id);
      else await createSession();
    }
  }

  function saveTranscript(sessionId: string, transcript: TranscriptEntry[]) {
    if (transcriptTimerRef.current) clearTimeout(transcriptTimerRef.current);
    transcriptTimerRef.current = setTimeout(() => {
      void fetch("/api/sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sessionId, transcript }),
      }).then(async (response) => {
        if (!response.ok) return;
        const result = (await response.json()) as { session: TutoringSession };
        setSessions((current) =>
          current.map((session) => (session.id === sessionId ? result.session : session)),
        );
        const currentSession = sessions.find((session) => session.id === sessionId);
        const firstLearnerTurn = transcript.find((entry) => entry.role === "learner")?.text.trim();
        if (currentSession && firstLearnerTurn && /^\w{3} \d{1,2},/.test(currentSession.title)) {
          void renameSession(sessionId, firstLearnerTurn.slice(0, 56));
        }
      });
    }, 700);
  }

  useEffect(() => {
    return () => {
      if (transcriptTimerRef.current) clearTimeout(transcriptTimerRef.current);
    };
  }, []);

  return {
    activeSessionId,
    createSession,
    deleteSession,
    isLoading,
    openSession,
    renameSession,
    saveTranscript,
    sessions,
  };
}