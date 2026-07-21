const PYODIDE_VERSION = "0.28.3";
const PYODIDE_BASE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let pyodidePromise;

function getPyodide() {
  if (!pyodidePromise) {
    importScripts(`${PYODIDE_BASE_URL}pyodide.js`);
    pyodidePromise = self.loadPyodide({ indexURL: PYODIDE_BASE_URL });
  }
  return pyodidePromise;
}

self.onmessage = async (event) => {
  const lines = [];

  try {
    const pyodide = await getPyodide();
    pyodide.setStdout({ batched: (line) => lines.push(line) });
    pyodide.setStderr({ batched: (line) => lines.push(line) });
    await pyodide.loadPackagesFromImports(event.data.code);

    const result = await pyodide.runPythonAsync(event.data.code);
    if (result !== undefined && result !== null && String(result) !== "None") {
      lines.push(String(result));
    }
    if (result && typeof result.destroy === "function") result.destroy();

    self.postMessage({ output: lines.join("\n"), error: null });
  } catch (error) {
    self.postMessage({
      output: lines.join("\n"),
      error: error && error.stack ? error.stack : String(error),
    });
  }
};