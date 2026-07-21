"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Code2,
  Eraser,
  Hand,
  LoaderCircle,
  Mic,
  MicOff,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  Trash2,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import { type Editor, Tldraw } from "tldraw";
import { useVoiceProfessor } from "@/hooks/use-voice-professor";
import { useLocalSessions } from "@/hooks/use-local-sessions";
import { importPdfToBoard } from "@/lib/pdf-actions";
import { CodeCellShapeUtil, createCodeCell } from "@/shapes/code-cell-shape";
import { PdfShapeUtil } from "@/shapes/pdf-shape";

type CanvasTool = "select" | "hand" | "draw" | "eraser";

type ToolButton = {
  id: CanvasTool;
  label: string;
  icon: LucideIcon;
};

const CANVAS_TOOLS: ToolButton[] = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "hand", label: "Pan", icon: Hand },
  { id: "draw", label: "Draw", icon: Pencil },
  { id: "eraser", label: "Erase", icon: Eraser },
];

const SHAPE_UTILS = [CodeCellShapeUtil, PdfShapeUtil];

export function ProfessorWorkspace() {
  const activeEditorRef = useRef<Editor | null>(null);
  const [mountedEditor, setMountedEditor] = useState<{
    sessionId: string;
    editor: Editor;
  } | null>(null);
  const [toolState, setToolState] = useState<{
    sessionId: string;
    tool: CanvasTool;
  } | null>(null);
  const [pdfNotice, setPdfNotice] = useState<string | null>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const localSessions = useLocalSessions();
  const editor =
    mountedEditor?.sessionId === localSessions.activeSessionId ? mountedEditor.editor : null;
  const activeTool =
    toolState?.sessionId === localSessions.activeSessionId ? toolState.tool : "select";
  const activeSession = localSessions.sessions.find(
    (session) => session.id === localSessions.activeSessionId,
  );
  const voice = useVoiceProfessor({
    editor,
    sessionId: localSessions.activeSessionId ?? "loading-session",
    onTranscriptChange: (transcript) => {
      if (localSessions.activeSessionId) {
        localSessions.saveTranscript(localSessions.activeSessionId, transcript);
      }
    },
  });
  const isLive = voice.status === "connected" && !voice.isMuted;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setShowWelcome(localStorage.getItem("trace-welcome-seen") !== "true");
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  function dismissWelcome() {
    localStorage.setItem("trace-welcome-seen", "true");
    setShowWelcome(false);
  }

  async function startFromWelcome() {
    dismissWelcome();
    await voice.toggleVoice();
  }

  function selectTool(tool: CanvasTool) {
    editor?.setCurrentTool(tool);
    if (localSessions.activeSessionId) {
      setToolState({ sessionId: localSessions.activeSessionId, tool });
    }
  }

  function addCodeCell() {
    if (!editor) return;
    createCodeCell(editor);
    if (localSessions.activeSessionId) {
      setToolState({ sessionId: localSessions.activeSessionId, tool: "select" });
    }
    editor.setCurrentTool("select");
  }

  const voiceLabel =
    voice.status === "connecting"
      ? "Connecting voice"
      : isLive
        ? "Pause microphone"
        : voice.isMuted
          ? "Resume microphone"
          : "Start voice conversation";

  const handleDropOnCanvas = useCallback(({
    event,
    point,
  }: {
    event: React.DragEvent<Element>;
    point: { x: number; y: number };
  }) => {
    const activeEditor = activeEditorRef.current;
    if (!activeEditor) return false;
    const files = [...event.dataTransfer.files];
    const pdfs = files.filter(
      (file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"),
    );
    if (!pdfs.length) return false;

    const otherFiles = files.filter((file) => !pdfs.includes(file));
    if (otherFiles.length) {
      void activeEditor.putExternalContent({ type: "files", files: otherFiles, point });
    }

    pdfs.forEach((file, index) => {
      setPdfNotice(`Opening ${file.name} locally…`);
      void importPdfToBoard(
        activeEditor,
        file,
        { x: point.x + index * 48, y: point.y + index * 48 },
        () => setPdfNotice(null),
      ).catch((error) => {
        setPdfNotice(error instanceof Error ? error.message : `Could not open ${file.name}.`);
      });
    });
    return true;
  }, []);

  const tldrawOptions = useMemo(
    () => ({ experimental__onDropOnCanvas: handleDropOnCanvas }),
    [handleDropOnCanvas],
  );

  const handleEditorMount = useCallback(
    (nextEditor: Editor) => {
      const sessionId = localSessions.activeSessionId;
      if (!sessionId) return;
      nextEditor.updateInstanceState({ isGridMode: false });
      nextEditor.setColorMode("light");
      activeEditorRef.current = nextEditor;
      setMountedEditor({ sessionId, editor: nextEditor });
    },
    [localSessions.activeSessionId],
  );

  return (
    <main className="professor-workspace">
      <div className="professor-canvas" aria-label="Shared whiteboard">
        {localSessions.activeSessionId ? (
          <Tldraw
            key={localSessions.activeSessionId}
            hideUi
            options={tldrawOptions}
            persistenceKey={`trace-session-${localSessions.activeSessionId}`}
            shapeUtils={SHAPE_UTILS}
            onMount={handleEditorMount}
            {...(process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY
              ? { licenseKey: process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY }
              : {})}
          />
        ) : null}
      </div>

      <button
        type="button"
        className="trace-wordmark"
        aria-label="Open local sessions"
        title="Local sessions"
        onClick={() => setSessionsOpen(true)}
      >
        trace
      </button>

      {showWelcome ? (
        <section className="welcome-card" aria-labelledby="welcome-title">
          <p className="welcome-eyebrow">Voice-first learning</p>
          <h1 id="welcome-title">Think out loud.<br />Trace works beside you.</h1>
          <p>
            Speak naturally while you draw, drop in a PDF, or write code. Your professor sees the same board.
          </p>
          <ul className="welcome-prompts" aria-label="Things to try">
            <li>Help me build an intuition for gradient descent.</li>
            <li>Quiz me from this PDF without giving away the answer.</li>
            <li>Let&apos;s trace this code together and test my prediction.</li>
          </ul>
          <button
            type="button"
            className="welcome-action"
            onClick={() => void startFromWelcome()}
            disabled={voice.status === "connecting"}
          >
            <Mic size={16} aria-hidden="true" />
            Start a conversation
          </button>
          <small className="welcome-footnote">Your PDFs and whiteboards stay on this device.</small>
        </section>
      ) : null}

      {sessionsOpen ? (
        <aside className="session-sheet" aria-label="Local tutoring sessions">
          <header className="session-sheet-header">
            <div>
              <strong>Sessions</strong>
              <span>Stored on this machine</span>
            </div>
            <div className="session-sheet-actions">
              <button
                type="button"
                aria-label="New session"
                title="New session"
                onClick={() => void localSessions.createSession()}
              >
                <Plus size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Close sessions"
                title="Close"
                onClick={() => setSessionsOpen(false)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          </header>

          {activeSession ? (
            <label className="session-title-editor">
              <span>Current</span>
              <input
                key={`${activeSession.id}-${activeSession.title}`}
                defaultValue={activeSession.title}
                maxLength={120}
                onBlur={(event) =>
                  void localSessions.renameSession(activeSession.id, event.currentTarget.value)
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            </label>
          ) : null}

          <div className="session-list">
            {localSessions.sessions.map((session) => (
              <div
                className={`session-row ${session.id === localSessions.activeSessionId ? "session-row-active" : ""}`}
                key={session.id}
              >
                <button
                  type="button"
                  className="session-row-open"
                  onClick={() => {
                    localSessions.openSession(session.id);
                    setSessionsOpen(false);
                  }}
                >
                  <span>{session.title}</span>
                  <small>
                    {session.transcriptCount
                      ? `${session.transcriptCount} conversation turns`
                      : "Blank conversation"}
                  </small>
                </button>
                <button
                  type="button"
                  className="session-row-delete"
                  aria-label={`Delete ${session.title}`}
                  title="Delete session"
                  onClick={() => void localSessions.deleteSession(session.id)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </aside>
      ) : null}

      <div className="board-tool-rail" role="toolbar" aria-label="Whiteboard tools">
        {CANVAS_TOOLS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-label={label}
            title={label}
            className={`minimal-tool-button ${activeTool === id ? "minimal-tool-button-active" : ""}`}
            onClick={() => selectTool(id)}
          >
            <Icon size={18} strokeWidth={1.9} />
          </button>
        ))}
        <span className="minimal-tool-divider" aria-hidden="true" />
        <button
          type="button"
          aria-label="Add code cell"
          title="Add code cell"
          className="minimal-tool-button"
          onClick={addCodeCell}
        >
          <Code2 size={18} strokeWidth={1.9} />
        </button>
      </div>

      <div className="board-history-rail" role="group" aria-label="Whiteboard history">
        <button
          type="button"
          aria-label="Undo"
          title="Undo"
          className="minimal-tool-button"
          onClick={() => editor?.undo()}
        >
          <Undo2 size={17} strokeWidth={1.9} />
        </button>
        <button
          type="button"
          aria-label="Redo"
          title="Redo"
          className="minimal-tool-button"
          onClick={() => editor?.redo()}
        >
          <Redo2 size={17} strokeWidth={1.9} />
        </button>
      </div>

      {voice.error ? <div className="voice-error" role="alert">{voice.error}</div> : null}
      {!voice.error && pdfNotice ? <div className="voice-error document-notice" role="status">{pdfNotice}</div> : null}

      <button
        type="button"
        className={`professor-mic ${isLive ? "professor-mic-live" : ""} ${voice.isSpeaking ? "professor-mic-speaking" : ""} ${voice.status === "error" ? "professor-mic-error" : ""}`}
        aria-label={voiceLabel}
        aria-busy={voice.status === "connecting"}
        title={voiceLabel}
        disabled={voice.status === "connecting"}
        onClick={() => {
          dismissWelcome();
          void voice.toggleVoice();
        }}
      >
        <span className="professor-mic-ring" aria-hidden="true" />
        {voice.status === "connecting" ? (
          <LoaderCircle className="spin" size={21} strokeWidth={1.9} />
        ) : voice.isMuted ? (
          <MicOff size={21} strokeWidth={1.9} />
        ) : (
          <Mic size={21} strokeWidth={1.9} />
        )}
      </button>
    </main>
  );
}
