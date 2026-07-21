"use client";

import { useCallback, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { indentWithTab } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { Play, X } from "lucide-react";
import {
  BaseBoxShapeUtil,
  type Editor,
  HTMLContainer,
  type RecordProps,
  T,
  type TLShape,
  type TLShapeId,
  createShapeId,
} from "tldraw";
import { type CodeLanguage, executeCode } from "@/lib/code-runner";
import { publishCodeActivity } from "@/lib/code-activity";

export const CODE_CELL_SHAPE_TYPE = "trace-code" as const;

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    [CODE_CELL_SHAPE_TYPE]: {
      w: number;
      h: number;
      language: CodeLanguage;
      code: string;
      output: string;
      error: string;
    };
  }
}

export type CodeCellShape = TLShape<typeof CODE_CELL_SHAPE_TYPE>;

function languageLabel(language: CodeLanguage) {
  if (language === "python") return "Python";
  if (language === "javascript") return "JavaScript";
  if (language === "cpp") return "C++20";
  return "C17";
}

function languageExtension(language: CodeLanguage) {
  if (language === "python") return python();
  if (language === "javascript") return javascript();
  return cpp();
}

function codePlaceholder(language: CodeLanguage) {
  if (language === "python") return "# Write Python…";
  if (language === "javascript") return "// Write JavaScript…";
  if (language === "cpp") return "// Write C++20…";
  return "/* Write C17… */";
}

const inlineCodeTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "#343936",
    backgroundColor: "#f7f6f2",
    fontSize: "12px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    lineHeight: "1.65",
  },
  ".cm-content": { padding: "10px 0 14px", caretColor: "#c6533a" },
  ".cm-line": { padding: "0 14px 0 8px" },
  ".cm-gutters": {
    color: "#a5aaa6",
    backgroundColor: "#f7f6f2",
    border: "none",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 7px 0 10px" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "rgba(39, 47, 42, 0.035)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "rgba(220, 98, 72, 0.16) !important",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#c6533a" },
  ".cm-matchingBracket": {
    color: "inherit",
    backgroundColor: "rgba(57, 112, 79, 0.13)",
    outline: "none",
  },
  ".cm-placeholder": { color: "#a5aaa6", fontStyle: "italic" },
});

const inlineHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: "#858b87", fontStyle: "italic" },
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword], color: "#a74432" },
  { tag: [tags.string, tags.special(tags.string)], color: "#39704f" },
  { tag: [tags.number, tags.bool, tags.null], color: "#946421" },
  { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: "#315d78" },
  { tag: [tags.className, tags.typeName], color: "#70568a" },
  { tag: [tags.operator, tags.punctuation], color: "#626864" },
  { tag: tags.propertyName, color: "#566f49" },
]);

const sharedEditorExtensions = [inlineCodeTheme, syntaxHighlighting(inlineHighlightStyle)];

export function createCodeCell(
  editor: Editor,
  options: {
    code?: string;
    language?: CodeLanguage;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
  } = {},
) {
  const viewport = editor.getViewportPageBounds();
  const w = options.w ?? Math.min(560, Math.max(320, viewport.w - 96));
  const h = options.h ?? Math.min(360, Math.max(260, viewport.h * 0.48));
  const id = createShapeId();

  editor.markHistoryStoppingPoint("create code cell");
  editor.createShape<CodeCellShape>({
    id,
    type: CODE_CELL_SHAPE_TYPE,
    x: options.x ?? viewport.x + (viewport.w - w) / 2,
    y: options.y ?? viewport.y + (viewport.h - h) / 2,
    props: {
      w,
      h,
      language: options.language ?? "python",
      code: options.code ?? "",
      output: "",
      error: "",
    },
  });
  editor.select(id);
  editor.setEditingShape(id);
  return id;
}

export async function runCodeCell(editor: Editor, shapeId: TLShapeId) {
  const shape = editor.getShape<CodeCellShape>(shapeId);
  if (!shape || shape.type !== CODE_CELL_SHAPE_TYPE) return null;

  editor.updateShape<CodeCellShape>({
    id: shape.id,
    type: shape.type,
    props: { output: "Running…", error: "" },
  });
  const result = await executeCode(shape.props.language, shape.props.code);
  editor.updateShape<CodeCellShape>({
    id: shape.id,
    type: shape.type,
    props: {
      output: result.output,
      error: result.error ?? "",
      h: Math.max(shape.props.h, 320),
    },
  });
  publishCodeActivity({
    shapeId: shape.id,
    language: shape.props.language,
    code: shape.props.code,
    output: result.output,
    error: result.error ?? "",
    phase: "run",
  });
  return result;
}

function CodeCell({ shape, util }: { shape: CodeCellShape; util: CodeCellShapeUtil }) {
  const [isRunning, setIsRunning] = useState(false);
  const isEditing = util.editor.getEditingShapeId() === shape.id;

  const updateProps = useCallback((props: Partial<CodeCellShape["props"]>) => {
    util.editor.updateShape({
      id: shape.id,
      type: shape.type,
      props,
    });
  }, [shape.id, shape.type, util.editor]);

  const run = useCallback(async () => {
    if (isRunning) return;
    setIsRunning(true);
    await runCodeCell(util.editor, shape.id);
    setIsRunning(false);
  }, [isRunning, shape.id, util.editor]);

  const extensions = useMemo(
    () => [
      ...sharedEditorExtensions,
      languageExtension(shape.props.language),
      keymap.of([
        indentWithTab,
        {
          key: "Mod-Enter",
          run: () => {
            void run();
            return true;
          },
        },
      ]),
    ],
    [run, shape.props.language],
  );

  const updateCode = useCallback((code: string) => {
    updateProps({ code });
    publishCodeActivity({
      shapeId: shape.id,
      language: shape.props.language,
      code,
      phase: "edit",
    });
  }, [shape.id, shape.props.language, updateProps]);

  function removeCodeCell() {
    util.editor.markHistoryStoppingPoint("remove code cell");
    util.editor.deleteShape(shape.id);
  }

  return (
    <HTMLContainer
      className={`trace-code-cell ${isEditing ? "trace-code-cell-editing" : ""} ${shape.props.output || shape.props.error ? "trace-code-cell-has-output" : ""}`}
      id={shape.id}
      onPointerDown={isEditing ? util.editor.markEventAsHandled : undefined}
      style={{
        width: shape.props.w,
        height: shape.props.h,
        pointerEvents: isEditing ? "all" : "none",
      }}
    >
      <div className="trace-code-header">
        <div className="trace-code-language">
          <span aria-hidden="true">&lt;/&gt;</span>
          {isEditing ? (
          <select
            aria-label="Code language"
            value={shape.props.language}
            onChange={(event) => {
              const language = event.target.value as CodeLanguage;
              updateProps({ language });
              publishCodeActivity({
                shapeId: shape.id,
                language,
                code: shape.props.code,
                phase: "edit",
              });
            }}
          >
            <option value="python">Python</option>
            <option value="javascript">JavaScript</option>
            <option value="c">C17</option>
            <option value="cpp">C++20</option>
          </select>
          ) : (
            <span>{languageLabel(shape.props.language)}</span>
          )}
        </div>
        <div className="trace-code-actions">
          {isEditing ? (
            <>
              <button
                type="button"
                className="trace-code-run"
                onClick={() => void run()}
                disabled={isRunning || !shape.props.code.trim()}
                aria-label={isRunning ? "Running code" : "Run code"}
                title="Run (Cmd/Ctrl+Enter)"
              >
                <Play size={12} fill="currentColor" aria-hidden="true" />
                <span>{isRunning ? "Running" : "Run"}</span>
              </button>
              <button
                type="button"
                className="trace-code-remove"
                onClick={removeCodeCell}
                aria-label="Close code block"
                title="Close code block (Undo to restore)"
              >
                <X size={13} aria-hidden="true" />
              </button>
            </>
          ) : (
            <span className="trace-code-hint">Double-click to edit</span>
          )}
        </div>
      </div>
      <CodeMirror
        aria-label="Code"
        autoFocus={isEditing}
        basicSetup={{
          autocompletion: false,
          bracketMatching: true,
          closeBrackets: true,
          completionKeymap: false,
          foldGutter: false,
          foldKeymap: false,
          highlightActiveLine: isEditing,
          highlightActiveLineGutter: false,
          highlightSelectionMatches: false,
          indentOnInput: true,
          lineNumbers: true,
          rectangularSelection: false,
        }}
        className="trace-code-editor"
        editable={isEditing}
        extensions={extensions}
        height="100%"
        indentWithTab
        onChange={updateCode}
        placeholder={codePlaceholder(shape.props.language)}
        readOnly={!isEditing}
        value={shape.props.code}
      />
      {(shape.props.output || shape.props.error) && (
        <div className="trace-code-output-panel">
          <div className="trace-code-output-header">
            <span>{shape.props.error ? "Error" : "Output"}</span>
            <button
              type="button"
              aria-label="Clear output"
              title="Clear output"
              onClick={() => updateProps({ output: "", error: "" })}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </div>
          <pre className={`trace-code-output ${shape.props.error ? "trace-code-output-error" : ""}`}>
            {shape.props.error || shape.props.output}
          </pre>
        </div>
      )}
    </HTMLContainer>
  );
}

export class CodeCellShapeUtil extends BaseBoxShapeUtil<CodeCellShape> {
  static override type = CODE_CELL_SHAPE_TYPE;

  static override props: RecordProps<CodeCellShape> = {
    w: T.number,
    h: T.number,
    language: T.literalEnum("python", "javascript", "c", "cpp"),
    code: T.string,
    output: T.string,
    error: T.string,
  };

  override canEdit() {
    return true;
  }

  override getText(shape: CodeCellShape) {
    return shape.props.code;
  }

  getDefaultProps(): CodeCellShape["props"] {
    return {
      w: 520,
      h: 300,
      language: "python",
      code: "",
      output: "",
      error: "",
    };
  }

  component(shape: CodeCellShape) {
    return <CodeCell shape={shape} util={this} />;
  }

  override toSvg(shape: CodeCellShape) {
    const codeLines = shape.props.code.split("\n").slice(0, 14);
    const output = shape.props.error || shape.props.output;

    return (
      <g>
        <rect width={shape.props.w} height={shape.props.h} rx={8} fill="#f7f6f2" />
        <rect width={shape.props.w} height={32} rx={8} fill="#ecebe6" />
        <text x={12} y={21} fill="#737975" fontFamily="monospace" fontSize={10}>
          {languageLabel(shape.props.language)}
        </text>
        <text x={16} y={52} fill="#343936" fontFamily="monospace" fontSize={11}>
          {codeLines.map((line, index) => (
            <tspan key={index} x={16} dy={index === 0 ? 0 : 17}>
              {line || " "}
            </tspan>
          ))}
        </text>
        {output ? (
          <text
            x={16}
            y={shape.props.h - 22}
            fill={shape.props.error ? "#a74432" : "#39704f"}
            fontFamily="monospace"
            fontSize={10}
          >
            {output.slice(0, 120)}
          </text>
        ) : null}
      </g>
    );
  }

  getIndicatorPath(shape: CodeCellShape) {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 10);
    return path;
  }
}