"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, FileText, LoaderCircle } from "lucide-react";
import {
  BaseBoxShapeUtil,
  type Editor,
  HTMLContainer,
  type RecordProps,
  T,
  type TLShape,
  createShapeId,
} from "tldraw";
import { type PdfPagePreview, renderLocalPdfPage } from "@/lib/pdf-library";

export const PDF_SHAPE_TYPE = "trace-pdf" as const;

type PdfStatus = "indexing" | "ready" | "error";

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    [PDF_SHAPE_TYPE]: {
      w: number;
      h: number;
      documentId: string;
      title: string;
      pageCount: number;
      page: number;
      indexedPages: number;
      status: PdfStatus;
      preview: string;
      error: string;
    };
  }
}

export type PdfShape = TLShape<typeof PDF_SHAPE_TYPE>;

export function createPdfShape(
  editor: Editor,
  document: { id: string; name: string; pageCount: number },
  preview: PdfPagePreview,
  point?: { x: number; y: number },
) {
  const viewport = editor.getViewportPageBounds();
  const width = Math.min(620, Math.max(360, viewport.w * 0.56));
  const height = Math.min(820, width * (preview.height / preview.width) + 42);
  const center = point ?? viewport.center;
  const id = createShapeId();

  editor.markHistoryStoppingPoint("add PDF");
  editor.createShape<PdfShape>({
    id,
    type: PDF_SHAPE_TYPE,
    x: center.x - width / 2,
    y: center.y - height / 2,
    props: {
      w: width,
      h: height,
      documentId: document.id,
      title: document.name,
      pageCount: document.pageCount,
      page: 1,
      indexedPages: 0,
      status: "indexing",
      preview: preview.dataUrl,
      error: "",
    },
  });
  editor.select(id);
  return id;
}

export async function showPdfPage(editor: Editor, documentId: string, page: number) {
  const shape = editor
    .getCurrentPageShapes()
    .find(
      (candidate): candidate is PdfShape =>
        candidate.type === PDF_SHAPE_TYPE && candidate.props.documentId === documentId,
    );
  if (!shape) return null;

  const nextPage = Math.max(1, Math.min(page, shape.props.pageCount));
  const preview = await renderLocalPdfPage(documentId, nextPage);
  editor.updateShape<PdfShape>({
    id: shape.id,
    type: shape.type,
    props: { page: nextPage, preview: preview.dataUrl, error: "" },
  });
  editor.select(shape.id);
  const bounds = editor.getShapePageBounds(shape);
  if (bounds) {
    editor.zoomToBounds(bounds, { inset: 64, animation: { duration: 480 } });
  }
  return { shapeId: shape.id, page: nextPage, title: shape.props.title };
}

function PdfViewer({ shape, util }: { shape: PdfShape; util: PdfShapeUtil }) {
  const [isLoadingPage, setIsLoadingPage] = useState(false);
  const isEditing = util.editor.getEditingShapeId() === shape.id;

  async function goToPage(page: number) {
    const nextPage = Math.max(1, Math.min(page, shape.props.pageCount));
    if (nextPage === shape.props.page || isLoadingPage) return;
    setIsLoadingPage(true);

    try {
      const preview = await renderLocalPdfPage(shape.props.documentId, nextPage);
      util.editor.updateShape<PdfShape>({
        id: shape.id,
        type: shape.type,
        props: { page: nextPage, preview: preview.dataUrl, error: "" },
      });
    } catch (error) {
      util.editor.updateShape<PdfShape>({
        id: shape.id,
        type: shape.type,
        props: { error: error instanceof Error ? error.message : "Could not render this page." },
      });
    } finally {
      setIsLoadingPage(false);
    }
  }

  return (
    <HTMLContainer
      className={`trace-pdf ${isEditing ? "trace-pdf-editing" : ""}`}
      id={shape.id}
      onPointerDown={isEditing ? util.editor.markEventAsHandled : undefined}
      style={{
        width: shape.props.w,
        height: shape.props.h,
        pointerEvents: isEditing ? "all" : "none",
      }}
    >
      <div className="trace-pdf-header">
        <div className="trace-pdf-title">
          <FileText size={13} aria-hidden="true" />
          <span>{shape.props.title}</span>
        </div>
        <div className="trace-pdf-navigation">
          {shape.props.status === "indexing" ? (
            <span className="trace-pdf-indexing">
              <LoaderCircle className="spin" size={11} aria-hidden="true" />
              {shape.props.indexedPages}/{shape.props.pageCount}
            </span>
          ) : null}
          {isEditing ? (
            <button
              type="button"
              aria-label="Previous PDF page"
              onClick={() => void goToPage(shape.props.page - 1)}
              disabled={shape.props.page <= 1 || isLoadingPage}
            >
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
          ) : null}
          <span>{shape.props.page} / {shape.props.pageCount}</span>
          {isEditing ? (
            <button
              type="button"
              aria-label="Next PDF page"
              onClick={() => void goToPage(shape.props.page + 1)}
              disabled={shape.props.page >= shape.props.pageCount || isLoadingPage}
            >
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
      <div className="trace-pdf-page">
        {isLoadingPage ? <LoaderCircle className="trace-pdf-page-loader spin" size={24} aria-hidden="true" /> : null}
        {/* PDF.js creates local data URLs with dimensions controlled by the canvas shape. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={shape.props.preview} alt={`${shape.props.title}, page ${shape.props.page}`} draggable={false} />
      </div>
      {shape.props.error ? <div className="trace-pdf-error">{shape.props.error}</div> : null}
    </HTMLContainer>
  );
}

export class PdfShapeUtil extends BaseBoxShapeUtil<PdfShape> {
  static override type = PDF_SHAPE_TYPE;

  static override props: RecordProps<PdfShape> = {
    w: T.number,
    h: T.number,
    documentId: T.string,
    title: T.string,
    pageCount: T.number,
    page: T.number,
    indexedPages: T.number,
    status: T.literalEnum("indexing", "ready", "error"),
    preview: T.string,
    error: T.string,
  };

  override canEdit() {
    return true;
  }

  override getText(shape: PdfShape) {
    return `${shape.props.title}, PDF page ${shape.props.page} of ${shape.props.pageCount}`;
  }

  getDefaultProps(): PdfShape["props"] {
    return {
      w: 520,
      h: 720,
      documentId: "",
      title: "PDF",
      pageCount: 1,
      page: 1,
      indexedPages: 0,
      status: "indexing",
      preview: "",
      error: "",
    };
  }

  component(shape: PdfShape) {
    return <PdfViewer shape={shape} util={this} />;
  }

  override toSvg(shape: PdfShape) {
    return (
      <g>
        <rect width={shape.props.w} height={shape.props.h} rx={8} fill="#f7f6f1" />
        <rect width={shape.props.w} height={36} rx={8} fill="#292d2a" />
        <text x={13} y={23} fill="#eef0ed" fontFamily="sans-serif" fontSize={11}>
          {shape.props.title.slice(0, 72)}
        </text>
        <text x={shape.props.w - 54} y={23} fill="#aeb5b1" fontFamily="sans-serif" fontSize={10}>
          {shape.props.page}/{shape.props.pageCount}
        </text>
        <image
          href={shape.props.preview}
          x={8}
          y={44}
          width={shape.props.w - 16}
          height={shape.props.h - 52}
          preserveAspectRatio="xMidYMid meet"
        />
      </g>
    );
  }

  getIndicatorPath(shape: PdfShape) {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 8);
    return path;
  }
}
