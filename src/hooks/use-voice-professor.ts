"use client";

import { useEffect, useRef, useState } from "react";
import {
  RealtimeAgent,
  RealtimeSession,
  tool,
  type RealtimeItem,
} from "@openai/agents/realtime";
import { z } from "zod";
import type { Editor as TldrawEditor, TLShapeId } from "tldraw";
import {
  captureBoard,
  clearBoard,
  createLearningLab,
  deleteBoardShapes,
  gestureAtBoardObject,
  insertGeneratedImage,
  renderSvgVisual,
  serializeBoard,
  startThinkingPulse,
  updateLearningLabStage,
} from "@/lib/canvas-actions";
import {
  CODE_CELL_SHAPE_TYPE,
  type CodeCellShape,
  createCodeCell,
  runCodeCell,
  setCodePrediction,
} from "@/shapes/code-cell-shape";
import {
  listLocalPdfDocuments,
  readLocalPdfPages,
  searchLocalPdfDocuments,
} from "@/lib/pdf-library";
import {
  type CodeActivity,
  subscribeToCodeActivity,
} from "@/lib/code-activity";
import type { TranscriptEntry } from "@/lib/session-types";
import { showPdfPage } from "@/shapes/pdf-shape";

export type VoiceStatus = "disconnected" | "connecting" | "connected" | "error";

type UseVoiceProfessorOptions = {
  editor: TldrawEditor | null;
  sessionId: string;
  onTranscriptChange?: (transcript: TranscriptEntry[]) => void;
};

type TokenResponse = {
  value?: string;
  error?: string;
};

type VisualCompositionRequest = {
  brief: string;
  purpose: "explain" | "compare" | "trace" | "illustrate" | "exercise" | "reflect";
  style:
    | "technical-sketch"
    | "scientific-illustration"
    | "data-graphic"
    | "spatial-map"
    | "chalkboard"
    | "editorial-illustration";
  aspect: "landscape" | "square" | "portrait";
  x?: number;
  y?: number;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "The voice session stopped unexpectedly.";
}

function getSessionId() {
  const storageKey = "trace-voice-session-id";
  const existing = window.localStorage.getItem(storageKey);
  if (existing) return existing;
  const sessionId = window.crypto.randomUUID();
  window.localStorage.setItem(storageKey, sessionId);
  return sessionId;
}

const PROFESSOR_INSTRUCTIONS = `
You are a professor sharing one live whiteboard with a learner. The interface is voice-only.

CONVERSATION
- Speak like a thoughtful professor at a board: natural, concise, and responsive.
- Do not announce UI state, coordinates, tool names, or hidden process.
- Ask a focused question when the learner should reason; explain directly when they need a model.
- Interruptions are normal. Stop cleanly and follow the learner's new direction.

THE BOARD
- You receive a current image of the board with each spoken turn.
- Treat dropped images, sketches, text, and code as shared context.
- Dropped PDFs are local books with searchable text. Use list_documents, search_document, and
  read_document_pages before making claims about a book or creating exercises from it.
- When creating exercises from a document, ground them in specific concepts or pages, vary the format,
  and coach the learner without immediately revealing complete solutions.
- When citing a document, offer to show the source. Use show_document_page to put the exact cited page
  on screen; never invent a page number or claim a page supports something you have not read.
- Draw only when a visual genuinely improves the explanation.
- Never default to dashboards, cards, generic box grids, or repetitive flowcharts.
- Prefer the visual language that fits the idea: curves, annotated sketches, number lines, plots,
  spatial maps, timelines, freeform labels, worked equations, state traces, or realistic SVG illustration.
- Use compose_visual for designed instructional visuals. Give it a precise teaching brief, purpose, and the
  visual style that fits the idea. A dedicated visual model sees the current board and writes the final SVG.
- compose_visual returns ordered teaching beats. As you explain the visual, call gesture_at_object with the
  returned shape ID and a beat's normalized coordinates so your spoken explanation visibly tracks the board.
- Use generate_image only when a photographic, painterly, highly realistic, or reference-style image is
  genuinely more useful than SVG. Prefer low quality for conversational speed unless the learner requests detail.
- Compose the whole visual intentionally. Use whitespace and a restrained palette; make labels readable.
- Use existing tldraw objects when the learner has already drawn something. Inspect before deleting.

LEARNING LABS
- A Learning Lab is an editable causal workspace inspired by visual computing: source → question → prediction →
  test → evidence → reflection. Use create_learning_lab when a concept benefits from an investigation that will
  evolve across several turns. Do not use it as a decorative flowchart or a substitute for a direct explanation.
- Leave prediction, evidence, and reflection as prompts until the learner supplies them. Then call
  update_learning_lab_stage with the exact stage ID returned by create_learning_lab and preserve the learner's words.
- Treat each connection as meaning: the source grounds the question, the prediction commits before the test,
  evidence comes from an observation, and reflection revises the model. Do not jump directly to the final box.
- When a PDF or code cell is involved, keep it visible beside the lab and use the lab to show what role it plays.

CODE
- Code lives on the whiteboard in executable Python, JavaScript, C17, and C++20 cells, never in a separate panel.
- Messages prefixed [LIVE CODE CONTEXT] are silent observations of the learner's latest editor state,
  not standalone requests. Use that state naturally when the learner speaks.
- Create a code cell when code is useful or requested. The learner can edit and run it directly.
- Update learner code only when asked or when they agree to a concrete change.
- When a run has a useful non-obvious outcome, ask the learner to predict it first. After they answer,
  call record_code_prediction with their words before run_code_cell. Do not invent or improve their prediction.
- After the run, compare prediction and observation and ask for a causal explanation before correcting them.

LEARNING EVIDENCE
- Do not equate listening, confidence, or completing a lesson with understanding. Look for evidence in the
  learner's explanations, predictions, corrections, sketches, or code.
- After a meaningful teaching sequence, briefly ask the learner to explain or predict something in their own words.
- When the learner asks to wrap up, offer to create a Learning Trace. Only call create_learning_trace after they agree.
- The trace must name the goal, specific demonstrated evidence, any misconception that changed, and one next challenge.
- Never claim mastery without evidence. Use language such as "you demonstrated" and "next test" instead.
- When the learner explicitly revises an important mental model, offer to preserve the change as a Misconception Trail.
  Only call create_misconception_trail after they agree, and preserve their original and revised ideas without ridicule.
`.trim();

export function useVoiceProfessor(options: UseVoiceProfessorOptions) {
  const optionsRef = useRef(options);
  const sessionRef = useRef<RealtimeSession | null>(null);
  const connectionRef = useRef<Promise<RealtimeSession | null> | null>(null);
  const responseQueueRef = useRef(Promise.resolve());
  const codeActivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestCodeActivityRef = useRef<CodeActivity | null>(null);
  const liveCodeItemIdRef = useRef<string | null>(null);
  const transcriptTimesRef = useRef(new Map<string, number>());
  const [status, setStatus] = useState<VoiceStatus>("disconnected");
  const [statusSessionId, setStatusSessionId] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  function persistTranscript(history: RealtimeItem[]) {
    const entries: TranscriptEntry[] = [];
    for (const item of history) {
      if (item.type !== "message" || item.role === "system") continue;
      let text = "";
      for (const content of item.content) {
        if ("text" in content && content.text) text += `${content.text}\n`;
        if ("transcript" in content && content.transcript) text += `${content.transcript}\n`;
      }
      text = text.trim();
      if (!text || text.startsWith("[LIVE CODE CONTEXT")) continue;
      if (!transcriptTimesRef.current.has(item.itemId)) {
        transcriptTimesRef.current.set(item.itemId, Date.now());
      }
      entries.push({
        id: item.itemId,
        role: item.role === "user" ? "learner" : "professor",
        text,
        createdAt: transcriptTimesRef.current.get(item.itemId)!,
      });
    }
    optionsRef.current.onTranscriptChange?.(entries);
  }

  function syncCodeContext(session: RealtimeSession, activity: CodeActivity) {
    if (liveCodeItemIdRef.current) {
      session.transport.sendEvent({
        type: "conversation.item.delete",
        item_id: liveCodeItemIdRef.current,
      });
    }

    const itemId = `item_trace_${crypto.randomUUID().replaceAll("-", "")}`;
    const resultText =
      activity.phase === "run"
        ? `\n\nRun result:\n${activity.error ? `Error: ${activity.error}` : activity.output || "No output"}`
        : "";
    session.transport.sendEvent({
      type: "conversation.item.create",
      item: {
        id: itemId,
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: `[LIVE CODE CONTEXT — ${activity.language}, cell ${activity.shapeId}]\n${activity.code.slice(0, 16_000)}${resultText}`,
          },
        ],
      },
    });
    liveCodeItemIdRef.current = itemId;
  }

  useEffect(() => {
    return subscribeToCodeActivity((activity) => {
      latestCodeActivityRef.current = activity;
      if (codeActivityTimerRef.current) clearTimeout(codeActivityTimerRef.current);
      codeActivityTimerRef.current = setTimeout(() => {
        if (sessionRef.current) syncCodeContext(sessionRef.current, activity);
      }, activity.phase === "run" ? 100 : 1_000);
    });
  }, []);

  function createProfessorAgent() {
    async function composeAndRenderVisual(request: VisualCompositionRequest) {
      const editor = optionsRef.current.editor;
      if (!editor) return "The board is not ready.";
      const point =
        typeof request.x === "number" && typeof request.y === "number"
          ? { x: request.x, y: request.y }
          : undefined;
      const stopThinkingPulse = startThinkingPulse(editor, point);
      const boardImage = await captureBoard(editor);
      try {
        const response = await fetch("/api/visuals/compose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...request,
            boardImage,
            boardObjects: JSON.stringify(serializeBoard(editor).slice(0, 100)),
            sessionId: getSessionId(),
          }),
        });
        const result = (await response.json()) as {
          title?: string;
          svg?: string;
          beats?: Array<{ label: string; x: number; y: number; gesture: string }>;
          error?: string;
        };
        if (!response.ok || !result.svg) {
          return result.error ?? "The visual could not be composed.";
        }
        const ids = await renderSvgVisual(editor, result.svg, point);
        return JSON.stringify({
          title: result.title,
          shapeIds: ids,
          teachingBeats: result.beats ?? [],
        });
      } finally {
        stopThinkingPulse();
      }
    }

    const inspectBoardTool = tool({
      name: "inspect_board",
      description: "Read all current whiteboard objects, text, code, outputs, and page-space bounds.",
      parameters: z.object({}),
      execute: async () => {
        const editor = optionsRef.current.editor;
        return editor ? JSON.stringify(serializeBoard(editor).slice(0, 150)) : "The board is not ready.";
      },
    });

    const listDocumentsTool = tool({
      name: "list_documents",
      description: "List PDFs currently available in the learner's local library and their indexing progress.",
      parameters: z.object({}),
      execute: async () => JSON.stringify(await listLocalPdfDocuments()),
    });

    const searchDocumentTool = tool({
      name: "search_document",
      description: "Search indexed PDF page text and return ranked page snippets.",
      parameters: z.object({
        query: z.string().min(1).max(500),
        documentId: z.string().optional(),
        maxResults: z.number().int().min(1).max(15).optional(),
      }),
      execute: async ({ query, documentId, maxResults }) =>
        JSON.stringify(await searchLocalPdfDocuments(query, documentId, maxResults ?? 8)),
    });

    const readDocumentPagesTool = tool({
      name: "read_document_pages",
      description: "Read up to eight consecutive pages of extracted text from a local PDF.",
      parameters: z.object({
        documentId: z.string(),
        startPage: z.number().int().min(1),
        endPage: z.number().int().min(1),
      }),
      execute: async ({ documentId, startPage, endPage }) =>
        readLocalPdfPages(documentId, startPage, endPage),
    });

    const showDocumentPageTool = tool({
      name: "show_document_page",
      description:
        "Navigate an existing PDF object to a verified cited page and focus the whiteboard camera on it.",
      parameters: z.object({
        documentId: z.string(),
        page: z.number().int().min(1),
      }),
      execute: async ({ documentId, page }) => {
        const editor = optionsRef.current.editor;
        if (!editor) return "The board is not ready.";
        try {
          const result = await showPdfPage(editor, documentId, page);
          return result
            ? JSON.stringify(result)
            : "That document is in the local library but is not currently on the board.";
        } catch (pageError) {
          return getErrorMessage(pageError);
        }
      },
    });

    const composeVisualTool = tool({
      name: "compose_visual",
      description:
        "Ask a dedicated visual-design model to compose and render a polished, board-aware SVG explanation.",
      parameters: z.object({
        brief: z.string().min(1).max(4_000),
        purpose: z.enum(["explain", "compare", "trace", "illustrate", "exercise"]),
        style: z.enum([
          "technical-sketch",
          "scientific-illustration",
          "data-graphic",
          "spatial-map",
          "chalkboard",
          "editorial-illustration",
        ]),
        aspect: z.enum(["landscape", "square", "portrait"]),
        x: z.number().optional(),
        y: z.number().optional(),
      }),
      timeoutMs: 90_000,
      execute: async (request) => composeAndRenderVisual(request),
    });

    const createLearningLabTool = tool({
      name: "create_learning_lab",
      description:
        "Create an editable connected investigation on the board: source, question, prediction, test, evidence, and reflection.",
      parameters: z.object({
        topic: z.string().min(1).max(160),
        source: z.string().min(1).max(360).optional(),
        question: z.string().min(1).max(360).optional(),
        test: z.string().min(1).max(360).optional(),
        x: z.number().optional(),
        y: z.number().optional(),
      }),
      execute: async ({ topic, source, question, test, x, y }) => {
        const editor = optionsRef.current.editor;
        if (!editor) return "The board is not ready.";
        const result = createLearningLab(editor, {
          topic,
          source,
          question,
          test,
          point: x === undefined || y === undefined ? undefined : { x, y },
        });
        return JSON.stringify({
          labId: result.labId,
          stageIds: result.stageIds,
          instruction:
            "Update prediction, evidence, and reflection only after the learner supplies them.",
        });
      },
    });

    const updateLearningLabStageTool = tool({
      name: "update_learning_lab_stage",
      description:
        "Write the learner's current contribution into one stage of an existing Learning Lab.",
      parameters: z.object({
        shapeId: z.string(),
        content: z.string().min(1).max(360),
      }),
      execute: async ({ shapeId, content }) => {
        const editor = optionsRef.current.editor;
        if (!editor) return "The board is not ready.";
        return updateLearningLabStage(editor, shapeId as TLShapeId, content)
          ? `Updated Learning Lab stage ${shapeId}.`
          : `No Learning Lab stage exists at ${shapeId}.`;
      },
    });

    const learningTraceTool = tool({
      name: "create_learning_trace",
      description:
        "Create a visual, evidence-based lesson recap on the board after the learner agrees to wrap up.",
      parameters: z.object({
        goal: z.string().min(1).max(240),
        demonstratedEvidence: z.array(z.string().min(1).max(280)).min(1).max(5),
        misconceptionChanged: z.string().max(320).optional(),
        nextChallenge: z.string().min(1).max(320),
        sourcePages: z
          .array(
            z.object({
              document: z.string().max(160),
              page: z.number().int().min(1),
            }),
          )
          .max(6)
          .optional(),
      }),
      timeoutMs: 90_000,
      execute: async ({
        goal,
        demonstratedEvidence,
        misconceptionChanged,
        nextChallenge,
        sourcePages,
      }) =>
        composeAndRenderVisual({
          purpose: "reflect",
          style: "editorial-illustration",
          aspect: "landscape",
          brief: [
            "Create a Learning Trace: a warm, rigorous visual record of this learner's progress.",
            `Learning goal: ${goal}`,
            `Demonstrated evidence: ${demonstratedEvidence.join(" | ")}`,
            misconceptionChanged
              ? `Misconception revised: ${misconceptionChanged}`
              : "Misconception revised: none observed; do not invent one.",
            `Next challenge: ${nextChallenge}`,
            sourcePages?.length
              ? `Verified sources: ${sourcePages.map((source) => `${source.document}, p. ${source.page}`).join("; ")}`
              : "Verified sources: none used; do not invent citations.",
            "Use an expressive path or progression rather than a dashboard. Distinguish observed evidence from the next unproven step. Keep every supplied claim intact and concise.",
          ].join("\n"),
        }),
    });

    const misconceptionTrailTool = tool({
      name: "create_misconception_trail",
      description:
        "Preserve an agreed before-evidence-after visual of how the learner revised an important mental model.",
      parameters: z.object({
        originalModel: z.string().min(1).max(420),
        turningEvidence: z.string().min(1).max(420),
        revisedModel: z.string().min(1).max(420),
        nextTest: z.string().min(1).max(320),
      }),
      timeoutMs: 90_000,
      execute: async ({ originalModel, turningEvidence, revisedModel, nextTest }) =>
        composeAndRenderVisual({
          purpose: "compare",
          style: "technical-sketch",
          aspect: "landscape",
          brief: [
            "Create a Misconception Trail that respectfully preserves a learner's conceptual revision.",
            `Original model, in the learner's terms: ${originalModel}`,
            `Turning evidence or counterexample: ${turningEvidence}`,
            `Revised model: ${revisedModel}`,
            `Next transfer test: ${nextTest}`,
            "Use a spatial before → evidence → after progression. Keep the original visible but lighter; do not use a red X, failure badge, score, or shaming language. Make the evidence the visual pivot.",
          ].join("\n"),
        }),
    });

    const gestureTool = tool({
      name: "gesture_at_object",
      description:
        "Point, circle, or underline a location on an existing board object while speaking about it.",
      parameters: z.object({
        shapeId: z.string(),
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        gesture: z.enum(["circle", "underline", "point"]),
      }),
      execute: async ({ shapeId, x, y, gesture }) => {
        const editor = optionsRef.current.editor;
        if (!editor) return "The board is not ready.";
        return gestureAtBoardObject(editor, shapeId, { x, y }, gesture)
          ? "Gesture started. Continue speaking while it animates."
          : `No board object exists at ${shapeId}.`;
      },
    });

    const createCodeTool = tool({
      name: "create_code_cell",
      description: "Create editable, executable Python, JavaScript, C17, or C++20 directly on the whiteboard.",
      parameters: z.object({
        language: z.enum(["python", "javascript", "c", "cpp"]),
        code: z.string().max(30_000),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().min(320).max(1000).optional(),
        height: z.number().min(320).max(800).optional(),
      }),
      execute: async ({ language, code, x, y, width, height }) => {
        const editor = optionsRef.current.editor;
        if (!editor) return "The board is not ready.";
        const id = createCodeCell(editor, { language, code, x, y, w: width, h: height });
        return `Created editable code cell ${id}.`;
      },
    });

    const generateImageTool = tool({
      name: "generate_image",
      description:
        "Generate a photographic, painterly, or realistic image with GPT Image 2 and place it on the whiteboard.",
      parameters: z.object({
        prompt: z.string().min(1).max(4_000),
        orientation: z.enum(["square", "landscape", "portrait"]),
        quality: z.enum(["low", "medium", "high"]).optional(),
        x: z.number().optional(),
        y: z.number().optional(),
      }),
      timeoutMs: 120_000,
      execute: async ({ prompt, orientation, quality, x, y }) => {
        const editor = optionsRef.current.editor;
        if (!editor) return "The board is not ready.";
        const sizes = {
          square: "1024x1024",
          landscape: "1536x1024",
          portrait: "1024x1536",
        } as const;
        const response = await fetch("/api/images/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            size: sizes[orientation],
            quality: quality ?? "low",
            sessionId: getSessionId(),
          }),
        });
        const result = (await response.json()) as {
          dataUrl?: string;
          revisedPrompt?: string | null;
          error?: string;
        };
        if (!response.ok || !result.dataUrl) {
          return result.error ?? "The image could not be generated.";
        }
        const point = typeof x === "number" && typeof y === "number" ? { x, y } : undefined;
        const ids = await insertGeneratedImage(editor, result.dataUrl, point);
        return JSON.stringify({ shapeIds: ids, revisedPrompt: result.revisedPrompt ?? prompt });
      },
    });

    const updateCodeTool = tool({
      name: "update_code_cell",
      description: "Replace the language or source of an existing whiteboard code cell.",
      parameters: z.object({
        shapeId: z.string(),
        language: z.enum(["python", "javascript", "c", "cpp"]).optional(),
        code: z.string().max(30_000),
      }),
      execute: async ({ shapeId, language, code }) => {
        const editor = optionsRef.current.editor;
        if (!editor) return "The board is not ready.";
        const shape = editor.getShape<CodeCellShape>(shapeId as TLShapeId);
        if (!shape || shape.type !== CODE_CELL_SHAPE_TYPE) return `No code cell exists at ${shapeId}.`;
        editor.updateShape<CodeCellShape>({
          id: shape.id,
          type: shape.type,
          props: { code, language: language ?? shape.props.language, output: "", error: "" },
          meta: {
            ...shape.meta,
            tracePrediction: "",
            tracePredictionRevealed: false,
          },
        });
        return `Updated code cell ${shape.id}.`;
      },
    });

    const runCodeTool = tool({
      name: "run_code_cell",
      description: "Execute an existing whiteboard code cell and return its output or error.",
      parameters: z.object({ shapeId: z.string() }),
      execute: async ({ shapeId }) => {
        const editor = optionsRef.current.editor;
        if (!editor) return "The board is not ready.";
        const result = await runCodeCell(editor, shapeId as TLShapeId);
        return result ? JSON.stringify(result) : `No code cell exists at ${shapeId}.`;
      },
    });

    const recordCodePredictionTool = tool({
      name: "record_code_prediction",
      description:
        "Pin the learner's spoken prediction beside a code cell before running it. Preserve their wording.",
      parameters: z.object({
        shapeId: z.string(),
        learnerPrediction: z.string().min(1).max(500),
      }),
      execute: async ({ shapeId, learnerPrediction }) => {
        const editor = optionsRef.current.editor;
        if (!editor) return "The board is not ready.";
        return setCodePrediction(editor, shapeId as TLShapeId, learnerPrediction)
          ? `Recorded the learner's prediction beside ${shapeId}.`
          : `No code cell exists at ${shapeId}.`;
      },
    });

    const deleteTool = tool({
      name: "delete_board_objects",
      description: "Delete specific whiteboard objects by ID after inspecting the board.",
      parameters: z.object({ shapeIds: z.array(z.string()).min(1).max(50) }),
      execute: async ({ shapeIds }) => {
        const editor = optionsRef.current.editor;
        if (!editor) return "The board is not ready.";
        return `Deleted ${deleteBoardShapes(editor, shapeIds)} objects.`;
      },
    });

    const clearTool = tool({
      name: "clear_board",
      description: "Clear the entire whiteboard only after the learner explicitly asks for it.",
      parameters: z.object({ learnerExplicitlyRequested: z.boolean() }),
      execute: async ({ learnerExplicitlyRequested }) => {
        const editor = optionsRef.current.editor;
        if (!editor) return "The board is not ready.";
        if (!learnerExplicitlyRequested) return "The board was not cleared.";
        clearBoard(editor);
        return "The board is clear.";
      },
    });

    return new RealtimeAgent({
      name: "Whiteboard professor",
      voice: "marin",
      instructions: PROFESSOR_INSTRUCTIONS,
      tools: [
        inspectBoardTool,
        listDocumentsTool,
        searchDocumentTool,
        readDocumentPagesTool,
        showDocumentPageTool,
        createLearningLabTool,
        updateLearningLabStageTool,
        composeVisualTool,
        learningTraceTool,
        misconceptionTrailTool,
        gestureTool,
        generateImageTool,
        createCodeTool,
        updateCodeTool,
        recordCodePredictionTool,
        runCodeTool,
        deleteTool,
        clearTool,
      ],
    });
  }

  async function respondWithBoard(session: RealtimeSession) {
    const editor = optionsRef.current.editor;
    if (editor) {
      const image = await captureBoard(editor);
      if (image) session.addImage(image, { triggerResponse: false });
    }
    session.transport.sendEvent({ type: "response.create" });
  }

  async function connect() {
    if (sessionRef.current) return sessionRef.current;
    if (connectionRef.current) return connectionRef.current;

    const connection = (async () => {
      setStatusSessionId(optionsRef.current.sessionId);
      setStatus("connecting");
      setError(null);

      try {
        const tokenResponse = await fetch("/api/realtime/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: getSessionId() }),
        });
        const token = (await tokenResponse.json()) as TokenResponse;
        if (!tokenResponse.ok || !token.value) {
          throw new Error(token.error ?? "Could not create a voice session.");
        }

        const session = new RealtimeSession(createProfessorAgent(), {
          model: "gpt-realtime-2.1",
          workflowName: "Trace whiteboard professor",
          config: {
            outputModalities: ["audio"],
            parallelToolCalls: false,
            reasoning: { effort: "low" },
            audio: {
              input: {
                noiseReduction: { type: "near_field" },
                transcription: { model: "gpt-4o-mini-transcribe" },
                turnDetection: {
                  type: "semantic_vad",
                  eagerness: "medium",
                  createResponse: false,
                  interruptResponse: true,
                },
              },
              output: { voice: "marin" },
            },
          },
        });

        session.on("transport_event", (event) => {
          if (event.type !== "input_audio_buffer.committed") return;
          responseQueueRef.current = responseQueueRef.current
            .catch(() => undefined)
            .then(() => respondWithBoard(session))
            .catch((responseError) => setError(getErrorMessage(responseError)));
        });
        session.on("history_updated", persistTranscript);
        session.on("audio_start", () => setIsSpeaking(true));
        session.on("audio_stopped", () => setIsSpeaking(false));
        session.on("audio_interrupted", () => setIsSpeaking(false));
        session.on("error", (event) => {
          setError(getErrorMessage(event.error));
          setStatus("error");
        });

        await session.connect({ apiKey: token.value });
        sessionRef.current = session;
        if (latestCodeActivityRef.current) {
          syncCodeContext(session, latestCodeActivityRef.current);
        }
        setStatus("connected");
        setIsMuted(false);
        return session;
      } catch (connectionError) {
        setError(getErrorMessage(connectionError));
        setStatus("error");
        return null;
      } finally {
        connectionRef.current = null;
      }
    })();

    connectionRef.current = connection;
    return connection;
  }

  async function toggleVoice() {
    if (!sessionRef.current) {
      await connect();
      return;
    }

    const nextMuted = !sessionRef.current.muted;
    sessionRef.current.mute(nextMuted);
    setIsMuted(nextMuted);
  }

  useEffect(() => {
    sessionRef.current?.close();
    sessionRef.current = null;
    connectionRef.current = null;
    responseQueueRef.current = Promise.resolve();
    liveCodeItemIdRef.current = null;
    latestCodeActivityRef.current = null;
    transcriptTimesRef.current.clear();
  }, [options.sessionId]);

  useEffect(() => {
    return () => {
      if (codeActivityTimerRef.current) clearTimeout(codeActivityTimerRef.current);
      sessionRef.current?.close();
      sessionRef.current = null;
    };
  }, []);

  const stateBelongsToActiveSession = statusSessionId === options.sessionId;

  return {
    error: stateBelongsToActiveSession ? error : null,
    isMuted: stateBelongsToActiveSession ? isMuted : false,
    isSpeaking: stateBelongsToActiveSession ? isSpeaking : false,
    status: stateBelongsToActiveSession ? status : ("disconnected" as const),
    toggleVoice,
  };
}
