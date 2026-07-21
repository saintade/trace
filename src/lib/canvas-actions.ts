import {
  createShapeId,
  type Editor,
  type TLArrowShape,
  type TLGeoShape,
  type TLShapeId,
  type TLTextShape,
  sanitizeSvg,
  toRichText,
} from "tldraw";
import {
  CODE_CELL_SHAPE_TYPE,
  type CodeCellShape,
} from "@/shapes/code-cell-shape";

export type LearningLabStageKey =
  | "source"
  | "question"
  | "prediction"
  | "test"
  | "evidence"
  | "reflection";

type LearningLabOptions = {
  topic: string;
  source?: string;
  question?: string;
  prediction?: string;
  test?: string;
  evidence?: string;
  reflection?: string;
  point?: { x: number; y: number };
};

const LEARNING_LAB_LABELS: Record<LearningLabStageKey, string> = {
  source: "SOURCE",
  question: "QUESTION",
  prediction: "PREDICTION",
  test: "TEST",
  evidence: "EVIDENCE",
  reflection: "REFLECTION",
};

function learningLabText(stage: LearningLabStageKey, content: string) {
  return `${LEARNING_LAB_LABELS[stage]}\n${content.trim().slice(0, 360)}`;
}

export function createLearningLab(editor: Editor, options: LearningLabOptions) {
  const labId = `lab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const nodeW = 220;
  const nodeH = 112;
  const gapX = 116;
  const gapY = 112;
  const labWidth = nodeW * 3 + gapX * 2;
  const labHeight = nodeH * 2 + gapY;
  const existingBounds = editor.getCurrentPageBounds();
  const center =
    options.point ??
    (existingBounds
      ? {
          x: existingBounds.x + existingBounds.w + 140 + labWidth / 2,
          y: existingBounds.y + existingBounds.h / 2,
        }
      : editor.getViewportPageBounds().center);
  const startX = center.x - labWidth / 2;
  const startY = center.y - labHeight / 2 + 24;
  const titleId = createShapeId();

  const stages: Array<{
    key: LearningLabStageKey;
    content: string;
    color: TLGeoShape["props"]["color"];
    x: number;
    y: number;
  }> = [
    {
      key: "source",
      content: options.source ?? "Select a PDF, sketch, example, or claim.",
      color: "grey",
      x: startX,
      y: startY,
    },
    {
      key: "question",
      content: options.question ?? "What are we trying to explain?",
      color: "blue",
      x: startX + nodeW + gapX,
      y: startY,
    },
    {
      key: "prediction",
      content: options.prediction ?? "What will happen—and why?",
      color: "orange",
      x: startX + (nodeW + gapX) * 2,
      y: startY,
    },
    {
      key: "test",
      content: options.test ?? "Run code, draw, or find a counterexample.",
      color: "red",
      x: startX + (nodeW + gapX) * 2,
      y: startY + nodeH + gapY,
    },
    {
      key: "evidence",
      content: options.evidence ?? "What did we observe?",
      color: "green",
      x: startX + nodeW + gapX,
      y: startY + nodeH + gapY,
    },
    {
      key: "reflection",
      content: options.reflection ?? "What changed? What should we test next?",
      color: "violet",
      x: startX,
      y: startY + nodeH + gapY,
    },
  ];

  const stageIds = Object.fromEntries(
    stages.map((stage) => [stage.key, createShapeId()]),
  ) as Record<LearningLabStageKey, TLShapeId>;
  const arrowIds: TLShapeId[] = [];

  const connections: Array<{
    from: LearningLabStageKey;
    to: LearningLabStageKey;
    fromAnchor: { x: number; y: number };
    toAnchor: { x: number; y: number };
  }> = [
    { from: "source", to: "question", fromAnchor: { x: 1, y: 0.5 }, toAnchor: { x: 0, y: 0.5 } },
    { from: "question", to: "prediction", fromAnchor: { x: 1, y: 0.5 }, toAnchor: { x: 0, y: 0.5 } },
    { from: "prediction", to: "test", fromAnchor: { x: 0.5, y: 1 }, toAnchor: { x: 0.5, y: 0 } },
    { from: "test", to: "evidence", fromAnchor: { x: 0, y: 0.5 }, toAnchor: { x: 1, y: 0.5 } },
    { from: "evidence", to: "reflection", fromAnchor: { x: 0, y: 0.5 }, toAnchor: { x: 1, y: 0.5 } },
  ];

  editor.markHistoryStoppingPoint("create learning lab");
  editor.run(() => {
    editor.createShape<TLTextShape>({
      id: titleId,
      type: "text",
      x: startX,
      y: startY - 74,
      props: {
        richText: toRichText(`LEARNING LAB  ·  ${options.topic.trim().slice(0, 120)}`),
        color: "black",
        font: "sans",
        size: "m",
      },
      meta: { traceLabId: labId, traceLabRole: "title" },
    });

    for (const stage of stages) {
      editor.createShape<TLGeoShape>({
        id: stageIds[stage.key],
        type: "geo",
        x: stage.x,
        y: stage.y,
        props: {
          geo: stage.key === "prediction" ? "cloud" : stage.key === "evidence" ? "oval" : "rectangle",
          w: nodeW,
          h: nodeH,
          color: stage.color,
          labelColor: "black",
          fill: "semi",
          dash: "draw",
          size: "s",
          font: "sans",
          align: "start",
          verticalAlign: "start",
          richText: toRichText(learningLabText(stage.key, stage.content)),
        },
        meta: { traceLabId: labId, traceLabStage: stage.key },
      });
    }

    for (const connection of connections) {
      const from = stages.find((stage) => stage.key === connection.from)!;
      const to = stages.find((stage) => stage.key === connection.to)!;
      const fromPoint = {
        x: from.x + nodeW * connection.fromAnchor.x,
        y: from.y + nodeH * connection.fromAnchor.y,
      };
      const toPoint = {
        x: to.x + nodeW * connection.toAnchor.x,
        y: to.y + nodeH * connection.toAnchor.y,
      };
      const arrowId = createShapeId();
      arrowIds.push(arrowId);
      editor.createShape<TLArrowShape>({
        id: arrowId,
        type: "arrow",
        x: fromPoint.x,
        y: fromPoint.y,
        props: {
          start: { x: 0, y: 0 },
          end: { x: toPoint.x - fromPoint.x, y: toPoint.y - fromPoint.y },
          color: "grey",
          dash: "draw",
          size: "s",
          arrowheadEnd: "arrow",
        },
        meta: { traceLabId: labId, traceLabRole: "connection" },
      });
      editor.createBindings([
        {
          type: "arrow",
          fromId: arrowId,
          toId: stageIds[connection.from],
          props: {
            terminal: "start",
            normalizedAnchor: connection.fromAnchor,
            isExact: false,
            isPrecise: false,
          },
        },
        {
          type: "arrow",
          fromId: arrowId,
          toId: stageIds[connection.to],
          props: {
            terminal: "end",
            normalizedAnchor: connection.toAnchor,
            isExact: false,
            isPrecise: false,
          },
        },
      ]);
    }
  });

  const createdIds = [titleId, ...Object.values(stageIds), ...arrowIds];
  const createdShapes = createdIds
    .map((id) => editor.getShape(id))
    .filter((shape) => shape !== undefined);
  editor.run(
    () => {
      for (const shape of createdShapes) {
        editor.updateShape({ id: shape.id, type: shape.type, y: shape.y + 16, opacity: 0 });
      }
    },
    { history: "ignore" },
  );
  editor.timers.requestAnimationFrame(() => {
    for (const shape of createdShapes) {
      editor.animateShape(
        { id: shape.id, type: shape.type, y: shape.y, opacity: 1 },
        { animation: { duration: 480, easing: (time) => 1 - Math.pow(1 - time, 3) } },
      );
    }
    editor.zoomToBounds(
      { x: startX - 42, y: startY - 92, w: labWidth + 84, h: labHeight + 146 },
      { inset: 56, animation: { duration: 480 } },
    );
  });

  return { labId, titleId, stageIds, arrowIds };
}

export function updateLearningLabStage(editor: Editor, shapeId: TLShapeId, content: string) {
  const shape = editor.getShape<TLGeoShape>(shapeId);
  const stage = shape?.meta.traceLabStage;
  if (!shape || shape.type !== "geo" || typeof stage !== "string" || !(stage in LEARNING_LAB_LABELS)) {
    return false;
  }
  editor.markHistoryStoppingPoint("update learning lab");
  editor.updateShape<TLGeoShape>({
    id: shape.id,
    type: shape.type,
    props: {
      richText: toRichText(learningLabText(stage as LearningLabStageKey, content)),
    },
  });
  return true;
}

export async function renderSvgVisual(
  editor: Editor,
  svg: string,
  point?: { x: number; y: number },
) {
  const sanitized = sanitizeSvg(svg.trim());
  if (!sanitized) throw new Error("The SVG did not contain any safe visual content.");

  const before = new Set(editor.getCurrentPageShapeIds());
  await editor.putExternalContent({
    type: "svg-text",
    text: sanitized,
    point: point ?? editor.getViewportPageBounds().center,
  });

  const createdIds = [...editor.getCurrentPageShapeIds()].filter((id) => !before.has(id));
  if (createdIds.length) {
    const finalShapes = createdIds
      .map((id) => editor.getShape(id))
      .filter((shape) => shape !== undefined);
    editor.run(
      () => {
        for (const shape of finalShapes) {
          editor.updateShape({
            id: shape.id,
            type: shape.type,
            y: shape.y + 18,
            opacity: 0,
          });
        }
      },
      { history: "ignore" },
    );
    editor.timers.requestAnimationFrame(() => {
      for (const shape of finalShapes) {
        editor.animateShape(
          { id: shape.id, type: shape.type, y: shape.y, opacity: 1 },
          { animation: { duration: 560, easing: (time) => 1 - Math.pow(1 - time, 3) } },
        );
      }
      editor.select(...createdIds);
      editor.zoomToSelectionIfOffscreen(64, { animation: { duration: 420 } });
    });
  }
  return createdIds;
}

type ProfessorGesture = "circle" | "underline" | "point";

function buildGesturePoints(
  center: { x: number; y: number },
  bounds: { w: number; h: number },
  gesture: ProfessorGesture,
) {
  if (gesture === "underline") {
    const width = Math.max(50, Math.min(180, bounds.w * 0.28));
    return Array.from({ length: 28 }, (_, index) => {
      const progress = index / 27;
      return {
        x: center.x - width / 2 + width * progress,
        y: center.y + 10 + Math.sin(progress * Math.PI * 2) * 2,
      };
    });
  }

  if (gesture === "point") {
    return [
      { x: center.x - 52, y: center.y - 42 },
      { x: center.x - 12, y: center.y - 8 },
      { x: center.x, y: center.y },
      { x: center.x - 18, y: center.y - 2 },
      { x: center.x - 5, y: center.y - 18 },
    ];
  }

  const radiusX = Math.max(24, Math.min(90, bounds.w * 0.15));
  const radiusY = Math.max(20, Math.min(70, bounds.h * 0.15));
  return Array.from({ length: 42 }, (_, index) => {
    const angle = (index / 41) * Math.PI * 2;
    return {
      x: center.x + Math.cos(angle) * radiusX,
      y: center.y + Math.sin(angle) * radiusY,
    };
  });
}

export function gestureAtBoardObject(
  editor: Editor,
  shapeId: string,
  normalized: { x: number; y: number },
  gesture: ProfessorGesture,
) {
  const shape = editor.getShape(shapeId as TLShapeId);
  if (!shape) return false;
  const bounds = editor.getShapePageBounds(shape);
  if (!bounds) return false;

  const center = {
    x: bounds.x + Math.max(0, Math.min(1, normalized.x)) * bounds.w,
    y: bounds.y + Math.max(0, Math.min(1, normalized.y)) * bounds.h,
  };
  const points = buildGesturePoints(center, bounds, gesture);
  const scribble = editor.scribbles.addScribble({
    color: "accent",
    opacity: 0.7,
    size: 5,
    delay: 0,
    shrink: 0.08,
    taper: true,
  });
  editor.setHintingShapes([shape.id]);
  const viewport = editor.getViewportPageBounds();
  const marginX = Math.min(100, viewport.w * 0.12);
  const marginY = Math.min(100, viewport.h * 0.12);
  const comfortablyVisible =
    center.x >= viewport.x + marginX &&
    center.x <= viewport.x + viewport.w - marginX &&
    center.y >= viewport.y + marginY &&
    center.y <= viewport.y + viewport.h - marginY;
  if (!comfortablyVisible) {
    const focusWidth = Math.min(520, Math.max(260, bounds.w * 0.42));
    const focusHeight = Math.min(380, Math.max(200, bounds.h * 0.42));
    editor.zoomToBounds(
      {
        x: center.x - focusWidth / 2,
        y: center.y - focusHeight / 2,
        w: focusWidth,
        h: focusHeight,
      },
      { inset: 72, animation: { duration: 420 } },
    );
  }

  points.forEach((point, index) => {
    window.setTimeout(() => {
      if (editor.isDisposed) return;
      editor.scribbles.addPoint(scribble.id, point.x, point.y, 0.75);
      if (index === points.length - 1) {
        editor.scribbles.complete(scribble.id);
        window.setTimeout(() => {
          if (editor.isDisposed) return;
          editor.scribbles.stop(scribble.id);
          editor.setHintingShapes([]);
        }, 1_800);
      }
    }, index * 14);
  });
  return true;
}

export function startThinkingPulse(editor: Editor, point?: { x: number; y: number }) {
  const center = point ?? editor.getViewportPageBounds().center;
  let stopped = false;
  const timeoutIds = new Set<number>();

  const pulse = () => {
    if (stopped || editor.isDisposed) return;
    const scribble = editor.scribbles.addScribble({
      color: "accent",
      opacity: 0.32,
      size: 3,
      delay: 0,
      shrink: 0.15,
      taper: true,
    });
    Array.from({ length: 24 }, (_, index) => index).forEach((index) => {
      const timeoutId = window.setTimeout(() => {
        timeoutIds.delete(timeoutId);
        if (stopped || editor.isDisposed) return;
        const angle = (index / 23) * Math.PI * 2;
        const radius = 13 + index * 0.45;
        editor.scribbles.addPoint(
          scribble.id,
          center.x + Math.cos(angle) * radius,
          center.y + Math.sin(angle) * radius,
          0.55,
        );
        if (index === 23) editor.scribbles.stop(scribble.id);
      }, index * 20);
      timeoutIds.add(timeoutId);
    });
  };

  pulse();
  const intervalId = window.setInterval(pulse, 1_800);
  return () => {
    stopped = true;
    window.clearInterval(intervalId);
    for (const timeoutId of timeoutIds) window.clearTimeout(timeoutId);
  };
}

export async function insertGeneratedImage(
  editor: Editor,
  dataUrl: string,
  point?: { x: number; y: number },
) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const file = new File([blob], `trace-${Date.now()}.jpg`, { type: "image/jpeg" });
  const before = new Set(editor.getCurrentPageShapeIds());

  await editor.putExternalContent({
    type: "files",
    files: [file],
    point: point ?? editor.getViewportPageBounds().center,
  });

  const createdIds = [...editor.getCurrentPageShapeIds()].filter((id) => !before.has(id));
  if (createdIds.length) editor.select(...createdIds);
  return createdIds;
}

export function serializeBoard(editor: Editor) {
  return editor.getCurrentPageShapes().map((shape) => {
    const bounds = editor.getShapePageBounds(shape);
    const base = {
      id: shape.id,
      type: shape.type,
      text: editor.getShapeUtil(shape).getText(shape) ?? "",
      bounds: bounds
        ? {
            x: Math.round(bounds.x),
            y: Math.round(bounds.y),
            w: Math.round(bounds.w),
            h: Math.round(bounds.h),
          }
        : null,
    };

    if (shape.type === CODE_CELL_SHAPE_TYPE) {
      const codeShape = shape as CodeCellShape;
      return {
        ...base,
        language: codeShape.props.language,
        output: codeShape.props.output,
        error: codeShape.props.error,
        prediction:
          typeof codeShape.meta.tracePrediction === "string"
            ? codeShape.meta.tracePrediction
            : "",
        predictionRevealed: codeShape.meta.tracePredictionRevealed === true,
      };
    }

    if (shape.type === "geo" && typeof shape.meta.traceLabStage === "string") {
      return {
        ...base,
        learningLabId:
          typeof shape.meta.traceLabId === "string" ? shape.meta.traceLabId : "",
        learningLabStage: shape.meta.traceLabStage,
      };
    }

    if (shape.type === "image" && shape.props.assetId) {
      const asset = editor.getAsset(shape.props.assetId);
      return {
        ...base,
        assetName: asset && "name" in asset.props ? asset.props.name : "image",
      };
    }

    return base;
  });
}

export async function captureBoard(editor: Editor) {
  const shapes = editor.getCurrentPageShapes();
  if (!shapes.length) return null;

  try {
    const image = await editor.toImageDataUrl(shapes, {
      format: "png",
      background: true,
      darkMode: false,
      padding: 32,
      pixelRatio: 1,
      scale: 1,
    });
    return image.url;
  } catch {
    return null;
  }
}

export function deleteBoardShapes(editor: Editor, shapeIds: string[]) {
  const existingIds = shapeIds.filter((id) => editor.getShape(id as TLShapeId));
  if (!existingIds.length) return 0;
  editor.markHistoryStoppingPoint("delete board shapes");
  editor.deleteShapes(existingIds as TLShapeId[]);
  return existingIds.length;
}

export function clearBoard(editor: Editor) {
  const ids = [...editor.getCurrentPageShapeIds()];
  if (!ids.length) return;
  editor.markHistoryStoppingPoint("clear board");
  editor.deleteShapes(ids);
}
