export type AdviceLevel = "calm" | "busy" | "danger";
export type AdviceSource = "cluster-agent" | "local-llm";

export interface AssessRequest {
  question: string;
  location?: { name: string; lat: number; lon: number };
  yolo?: { people: number; vehicles: number; camera: string };
}

/** One VSS clip the CAMP agent grounded its answer on (Cosmos description + YOLO counts). */
export interface AdviceEvidence {
  video: string;
  camera: string;
  start_s: number;
  end_s: number;
  description: string;
  similarity: number;
  counts: Record<string, number>;
}

export interface Assessment {
  level: AdviceLevel;
  advice: string;
  reasons: string[];
  evidence: AdviceEvidence[];
  source: AdviceSource;
  /** Live TfL cameras whose YOLO counts fed the answer. */
  liveCams: number;
  trace?: { weave_project?: string };
  at: number;
}
