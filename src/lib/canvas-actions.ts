import {
  type Editor,
  type TLShapeId,
  sanitizeSvg,
} from "tldraw";
import {
  CODE_CELL_SHAPE_TYPE,
  type CodeCellShape,
} from "@/shapes/code-cell-shape";

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