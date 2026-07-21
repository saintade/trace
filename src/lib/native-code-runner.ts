import "server-only";

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CodeRunResult, NativeCodeLanguage } from "@/lib/code-runner";

type ProcessResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputLimitExceeded: boolean;
};

const COMPILE_TIMEOUT_MS = 15_000;
const RUN_TIMEOUT_MS = 4_000;
const MAX_OUTPUT_BYTES = 512 * 1024;
const RUN_ROOT = "/private/tmp/trace-code-runs";

const COMPILER_CANDIDATES: Record<NativeCodeLanguage, Array<string | undefined>> = {
  c: [
    process.env.TRACE_C_COMPILER,
    "/opt/homebrew/opt/llvm/bin/clang",
    "/usr/local/opt/llvm/bin/clang",
    "/usr/bin/clang",
  ],
  cpp: [
    process.env.TRACE_CPP_COMPILER,
    "/opt/homebrew/opt/llvm/bin/clang++",
    "/usr/local/opt/llvm/bin/clang++",
    "/usr/bin/clang++",
  ],
};

async function findCompiler(language: NativeCodeLanguage) {
  for (const candidate of COMPILER_CANDIDATES[language]) {
    if (!candidate || !path.isAbsolute(candidate)) continue;
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next known local compiler path.
    }
  }
  return null;
}

function escapeSandboxPath(value: string) {
  return JSON.stringify(value);
}

function createSandboxProfile(tempDirectory: string, phase: "compile" | "run") {
  return `
(version 1)
(allow default)
(deny network*)
(deny file-read* (subpath "/Users"))
(allow file-read* (subpath ${escapeSandboxPath(tempDirectory)}))
(deny file-write*)
(allow file-write*
  (subpath ${escapeSandboxPath(tempDirectory)})
  (literal "/dev/null"))
${phase === "run" ? "(deny process-fork)" : ""}
`.trim();
}

function runProcess(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number },
) {
  return new Promise<ProcessResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let timedOut = false;
    let outputLimitExceeded = false;
    let settled = false;

    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: true,
      env: {
        HOME: options.cwd,
        LANG: "C",
        LC_ALL: "C",
        NODE_ENV: process.env.NODE_ENV ?? "production",
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        TMPDIR: options.cwd,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    function killProcessGroup() {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }

    function appendOutput(target: "stdout" | "stderr", chunk: Buffer) {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        outputLimitExceeded = true;
        killProcessGroup();
        return;
      }
      if (target === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    }

    child.stdout.on("data", (chunk: Buffer) => appendOutput("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => appendOutput("stderr", chunk));

    const timeout = setTimeout(() => {
      timedOut = true;
      killProcessGroup();
    }, options.timeoutMs);

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        code: null,
        signal: null,
        stdout,
        stderr: `${stderr}${stderr ? "\n" : ""}${error.message}`,
        timedOut,
        outputLimitExceeded,
      });
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr, timedOut, outputLimitExceeded });
    });
  });
}

function processFailure(result: ProcessResult, phase: "Compilation" | "Execution") {
  if (result.timedOut) return `${phase} stopped after its time limit.`;
  if (result.outputLimitExceeded) return `${phase} stopped after producing too much output.`;
  return (
    result.stderr.trim() ||
    (result.signal
      ? `${phase} was terminated by ${result.signal}.`
      : `${phase} exited with code ${result.code ?? "unknown"}.`)
  );
}

export async function runNativeCode(
  language: NativeCodeLanguage,
  code: string,
): Promise<CodeRunResult> {
  const startedAt = performance.now();

  if (process.platform !== "darwin") {
    return {
      output: "No output",
      error: "Local C/C++ execution currently requires macOS sandbox-exec.",
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  const compiler = await findCompiler(language);
  if (!compiler) {
    return {
      output: "No output",
      error:
        language === "c"
          ? "No local C compiler was found. Install Xcode Command Line Tools or set TRACE_C_COMPILER."
          : "No local C++ compiler was found. Install Xcode Command Line Tools or set TRACE_CPP_COMPILER.",
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  await mkdir(RUN_ROOT, { recursive: true });
  const directory = await mkdtemp(path.join(RUN_ROOT, "run-"));
  const sourcePath = `${directory}/${language === "c" ? "main.c" : "main.cpp"}`;
  const executablePath = `${directory}/program`;

  try {
    await writeFile(sourcePath, code, { encoding: "utf8", mode: 0o600 });
    const compileProfile = createSandboxProfile(directory, "compile");
    const standard = language === "c" ? "c17" : "c++20";
    const compilation = await runProcess(
      "/usr/bin/sandbox-exec",
      [
        "-p",
        compileProfile,
        compiler,
        `-std=${standard}`,
        "-O0",
        "-Wall",
        "-Wextra",
        "-pedantic",
        "-fno-color-diagnostics",
        sourcePath,
        "-o",
        executablePath,
      ],
      { cwd: directory, timeoutMs: COMPILE_TIMEOUT_MS },
    );

    if (compilation.code !== 0 || compilation.timedOut || compilation.outputLimitExceeded) {
      return {
        output: "No output",
        error: processFailure(compilation, "Compilation"),
        durationMs: Math.round(performance.now() - startedAt),
      };
    }

    const execution = await runProcess(
      "/usr/bin/sandbox-exec",
      ["-p", createSandboxProfile(directory, "run"), executablePath],
      { cwd: directory, timeoutMs: RUN_TIMEOUT_MS },
    );
    const diagnostics = compilation.stderr.trim();
    const output = [diagnostics, execution.stdout.trim()].filter(Boolean).join("\n\n") || "No output";
    const executionError =
      execution.code === 0 && !execution.timedOut && !execution.outputLimitExceeded
        ? null
        : processFailure(execution, "Execution");

    return {
      output,
      error: executionError,
      durationMs: Math.round(performance.now() - startedAt),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}