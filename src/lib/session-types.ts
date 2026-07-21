export type TutoringSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  transcriptCount: number;
};

export type TranscriptEntry = {
  id: string;
  role: "learner" | "professor";
  text: string;
  createdAt: number;
};