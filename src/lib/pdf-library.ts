"use client";

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

export type LocalPdfDocument = {
  id: string;
  name: string;
  pageCount: number;
  indexedPages: number;
  pageTexts: string[];
  data: ArrayBuffer;
  createdAt: number;
};

export type PdfPagePreview = {
  dataUrl: string;
  width: number;
  height: number;
};

export type PdfSearchResult = {
  documentId: string;
  documentName: string;
  page: number;
  snippet: string;
  occurrences: number;
};

type IngestCallbacks = {
  onReady?: (document: LocalPdfDocument, preview: PdfPagePreview) => void;
  onProgress?: (document: LocalPdfDocument) => void;
};

const DB_NAME = "trace-local-library";
const DB_VERSION = 1;
const STORE_NAME = "pdfs";
const memoryDocuments = new Map<string, LocalPdfDocument>();
const documentProxies = new Map<string, Promise<PDFDocumentProxy>>();
let pdfJsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

function getPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      return pdfjs;
    });
  }
  return pdfJsPromise;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the local PDF library."));
  });
}

async function saveDocument(document: LocalPdfDocument) {
  memoryDocuments.set(document.id, document);
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(document);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save the PDF locally."));
  });
  database.close();
}

export async function getLocalPdfDocument(id: string) {
  const cached = memoryDocuments.get(id);
  if (cached) return cached;

  const database = await openDatabase();
  const document = await new Promise<LocalPdfDocument | null>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve((request.result as LocalPdfDocument | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Could not read the local PDF."));
  });
  database.close();
  if (document) memoryDocuments.set(document.id, document);
  return document;
}

export async function listLocalPdfDocuments() {
  const database = await openDatabase();
  const stored = await new Promise<LocalPdfDocument[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as LocalPdfDocument[]);
    request.onerror = () => reject(request.error ?? new Error("Could not list local PDFs."));
  });
  database.close();

  for (const document of stored) {
    if (!memoryDocuments.has(document.id)) memoryDocuments.set(document.id, document);
  }
  return [...memoryDocuments.values()].map((document) => ({
    id: document.id,
    name: document.name,
    pageCount: document.pageCount,
    indexedPages: document.indexedPages,
    createdAt: document.createdAt,
  }));
}

async function loadProxy(document: LocalPdfDocument) {
  let proxy = documentProxies.get(document.id);
  if (!proxy) {
    proxy = getPdfJs().then((pdfjs) =>
      pdfjs.getDocument({ data: new Uint8Array(document.data.slice(0)) }).promise,
    );
    documentProxies.set(document.id, proxy);
  }
  return proxy;
}

function canvasToDataUrl(canvas: HTMLCanvasElement) {
  return canvas.toDataURL("image/jpeg", 0.88);
}

async function renderPage(page: PDFPageProxy, maxWidth = 1200): Promise<PdfPagePreview> {
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2, maxWidth / baseViewport.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas rendering is unavailable.");

  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;

  return {
    dataUrl: canvasToDataUrl(canvas),
    width: canvas.width,
    height: canvas.height,
  };
}

function extractPageText(content: Awaited<ReturnType<PDFPageProxy["getTextContent"]>>) {
  let text = "";
  for (const item of content.items) {
    if (!("str" in item)) continue;
    text += item.str;
    text += item.hasEOL ? "\n" : " ";
  }
  return text.replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ").trim();
}

export async function ingestPdfFile(file: File, callbacks: IngestCallbacks = {}) {
  const pdfjs = await getPdfJs();
  const data = await file.arrayBuffer();
  const proxy = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
  const id = `pdf-${crypto.randomUUID()}`;
  const document: LocalPdfDocument = {
    id,
    name: file.name.replace(/\.pdf$/i, ""),
    pageCount: proxy.numPages,
    indexedPages: 0,
    pageTexts: Array.from({ length: proxy.numPages }, () => ""),
    data,
    createdAt: Date.now(),
  };

  memoryDocuments.set(id, document);
  documentProxies.set(id, Promise.resolve(proxy));

  const firstPage = await proxy.getPage(1);
  const preview = await renderPage(firstPage);
  await saveDocument(document);
  callbacks.onReady?.(document, preview);

  for (let pageNumber = 1; pageNumber <= proxy.numPages; pageNumber += 1) {
    const page = pageNumber === 1 ? firstPage : await proxy.getPage(pageNumber);
    document.pageTexts[pageNumber - 1] = extractPageText(await page.getTextContent());
    document.indexedPages = pageNumber;
    callbacks.onProgress?.(document);
  }

  await saveDocument(document);
  return document;
}

export async function renderLocalPdfPage(documentId: string, pageNumber: number, maxWidth = 1200) {
  const document = await getLocalPdfDocument(documentId);
  if (!document) throw new Error("This PDF is no longer available in the local library.");
  const proxy = await loadProxy(document);
  const boundedPage = Math.max(1, Math.min(pageNumber, proxy.numPages));
  return renderPage(await proxy.getPage(boundedPage), maxWidth);
}

export async function readLocalPdfPages(documentId: string, startPage: number, endPage: number) {
  const document = await getLocalPdfDocument(documentId);
  if (!document) throw new Error("PDF not found in the local library.");

  const start = Math.max(1, Math.min(startPage, document.pageCount));
  const end = Math.max(start, Math.min(endPage, start + 7, document.indexedPages || document.pageCount));
  return Array.from({ length: end - start + 1 }, (_, offset) => {
    const page = start + offset;
    return `--- Page ${page} ---\n${document.pageTexts[page - 1] || "[Page text is still indexing.]"}`;
  }).join("\n\n").slice(0, 36_000);
}

export async function searchLocalPdfDocuments(
  query: string,
  documentId?: string,
  maxResults = 8,
) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];
  const terms = normalizedQuery.split(/\s+/).filter((term) => term.length > 1);
  const documents = documentId
    ? [await getLocalPdfDocument(documentId)].filter((document): document is LocalPdfDocument => Boolean(document))
    : await Promise.all((await listLocalPdfDocuments()).map((document) => getLocalPdfDocument(document.id))).then(
        (items) => items.filter((document): document is LocalPdfDocument => Boolean(document)),
      );
  const results: PdfSearchResult[] = [];

  for (const document of documents) {
    document.pageTexts.forEach((pageText, pageIndex) => {
      if (!pageText) return;
      const lowerText = pageText.toLowerCase();
      const matchIndex = lowerText.indexOf(normalizedQuery);
      const termMatches = terms.reduce((total, term) => total + (lowerText.includes(term) ? 1 : 0), 0);
      if (matchIndex < 0 && termMatches === 0) return;

      const anchor = matchIndex >= 0 ? matchIndex : Math.max(0, lowerText.indexOf(terms[0] ?? ""));
      const start = Math.max(0, anchor - 220);
      const end = Math.min(pageText.length, anchor + normalizedQuery.length + 420);
      const occurrences = matchIndex >= 0 ? lowerText.split(normalizedQuery).length - 1 : termMatches;
      results.push({
        documentId: document.id,
        documentName: document.name,
        page: pageIndex + 1,
        snippet: pageText.slice(start, end).replace(/\s+/g, " ").trim(),
        occurrences,
      });
    });
  }

  return results
    .sort((first, second) => second.occurrences - first.occurrences)
    .slice(0, Math.max(1, Math.min(maxResults, 15)));
}