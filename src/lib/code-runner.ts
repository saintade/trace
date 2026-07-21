export type NativeCodeLanguage = "c" | "cpp";
export type CodeLanguage = "python" | "javascript" | NativeCodeLanguage;

export type CodeRunResult = {
  output: string;
  error: string | null;
  durationMs: number;
};

type WorkerResult = {
  output?: string;
  error?: string | null;
};

const RUN_TIMEOUT_MS = 25_000;

function createJavaScriptWorker() {
  const source = `
    function formatValue(value) {
      if (typeof value === "string") return value;
      if (typeof value === "undefined") return "undefined";
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }

    self.onmessage = async function (event) {
      const lines = [];
      const sandboxConsole = {
        log: function (...values) { lines.push(values.map(formatValue).join(" ")); },
        info: function (...values) { lines.push(values.map(formatValue).join(" ")); },
        warn: function (...values) { lines.push("Warning: " + values.map(formatValue).join(" ")); },
        error: function (...values) { lines.push("Error: " + values.map(formatValue).join(" ")); },
      };

      try {
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        const run = new AsyncFunction("console", event.data.code);
        const result = await run(sandboxConsole);
        if (typeof result !== "undefined") lines.push(formatValue(result));
        self.postMessage({ output: lines.join("\\n"), error: null });
      } catch (error) {
        self.postMessage({
          output: lines.join("\\n"),
          error: error && error.stack ? error.stack : String(error),
        });
      }
    };
  `;
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  return { worker: new Worker(url), url };
}

function runWorker(worker: Worker, code: string, objectUrl?: string) {
  const startedAt = performance.now();

  return new Promise<CodeRunResult>((resolve) => {
    let settled = false;

    function finish(result: WorkerResult) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      worker.terminate();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      resolve({
        output: result.output?.trim() || "No output",
        error: result.error ?? null,
        durationMs: Math.round(performance.now() - startedAt),
      });
    }

    const timeoutId = window.setTimeout(() => {
      finish({
        error: `Execution stopped after ${RUN_TIMEOUT_MS / 1000} seconds.`,
        output: "",
      });
    }, RUN_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<WorkerResult>) => finish(event.data);
    worker.onerror = (event) => {
      finish({
        error: event.message || "The code worker stopped unexpectedly.",
        output: "",
      });
    };
    worker.postMessage({ code });
  });
}

export function executeCode(language: CodeLanguage, code: string) {
  if (language === "python") {
    return runWorker(new Worker("/python-worker.js"), code);
  }

  if (language === "c" || language === "cpp") {
    const startedAt = performance.now();
    return fetch("/api/code/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, code }),
    })
      .then(async (response) => {
        const result = (await response.json()) as Partial<CodeRunResult> & { error?: string | null };
        if (!response.ok) {
          return {
            output: "No output",
            error: result.error ?? "The local compiler request failed.",
            durationMs: Math.round(performance.now() - startedAt),
          };
        }
        return {
          output: result.output ?? "No output",
          error: result.error ?? null,
          durationMs: result.durationMs ?? Math.round(performance.now() - startedAt),
        };
      })
      .catch((error: unknown) => ({
        output: "No output",
        error: error instanceof Error ? error.message : "The local compiler request failed.",
        durationMs: Math.round(performance.now() - startedAt),
      }));
  }

  const { worker, url } = createJavaScriptWorker();
  return runWorker(worker, code, url);
}