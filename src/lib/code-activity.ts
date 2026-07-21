import type { CodeLanguage } from "@/lib/code-runner";

export type CodeActivity = {
  shapeId: string;
  language: CodeLanguage;
  code: string;
  output?: string;
  error?: string;
  phase: "edit" | "run";
};

const listeners = new Set<(activity: CodeActivity) => void>();

export function publishCodeActivity(activity: CodeActivity) {
  for (const listener of listeners) listener(activity);
}

export function subscribeToCodeActivity(listener: (activity: CodeActivity) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}