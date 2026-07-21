"use client";

import type { Editor } from "tldraw";
import { ingestPdfFile } from "@/lib/pdf-library";
import { PDF_SHAPE_TYPE, type PdfShape, createPdfShape } from "@/shapes/pdf-shape";

export async function importPdfToBoard(
  editor: Editor,
  file: File,
  point?: { x: number; y: number },
  onShapeReady?: (shapeId: PdfShape["id"]) => void,
) {
  let shapeId: PdfShape["id"] | null = null;

  try {
    const document = await ingestPdfFile(file, {
      onReady: (readyDocument, preview) => {
        shapeId = createPdfShape(editor, readyDocument, preview, point);
        onShapeReady?.(shapeId);
      },
      onProgress: (progressDocument) => {
        if (!shapeId) return;
        if (
          progressDocument.indexedPages !== progressDocument.pageCount &&
          progressDocument.indexedPages % 5 !== 0
        ) {
          return;
        }
        editor.run(
          () => {
            editor.updateShape<PdfShape>({
              id: shapeId!,
              type: PDF_SHAPE_TYPE,
              props: {
                indexedPages: progressDocument.indexedPages,
                status:
                  progressDocument.indexedPages === progressDocument.pageCount ? "ready" : "indexing",
              },
            });
          },
          { history: "ignore" },
        );
      },
    });

    if (shapeId) {
      editor.run(
        () => {
          editor.updateShape<PdfShape>({
            id: shapeId!,
            type: PDF_SHAPE_TYPE,
            props: { indexedPages: document.pageCount, status: "ready" },
          });
        },
        { history: "ignore" },
      );
    }
    return shapeId;
  } catch (error) {
    if (shapeId) {
      editor.updateShape<PdfShape>({
        id: shapeId,
        type: PDF_SHAPE_TYPE,
        props: {
          status: "error",
          error: error instanceof Error ? error.message : "Could not import this PDF.",
        },
      });
    }
    throw error;
  }
}