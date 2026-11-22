export type DefectType =
  | 'SCRATCH'
  | 'DENT'
  | 'MISSING_TORQUE_MARK'
  | 'LOOSE_BOLT'
  | 'PAINT_DEFECT'
  | 'WRONG_PART'
  | 'DIMENSION_OUT'
  | 'WELD_DEFECT'
  | 'OTHER';

export type Severity = 'CRITICAL' | 'MAJOR' | 'MINOR';

export type SensitiveKind = 'CUSTOMER' | 'DRAWING_NO' | 'PRICE' | 'PERSON' | 'OTHER';

export interface SensitiveSpan {
  text: string;
  kind: SensitiveKind;
}

export interface GlobalTokenEntry {
  token: string;
  original: string;
  kind: SensitiveKind;
  createdAt: string;
}

export interface StructuredDefect {
  defectType: DefectType;
  part: string;
  location: string;
  quantity: number;
  severity: Severity;
  suspectedCause: string;
  immediateAction: string;
  sensitiveSpans: SensitiveSpan[];
  confidence: number;
}

export type InferenceSourceType = 'on_device' | 'in_cloud' | 'none';
export type SyncStatus = 'pending' | 'synced' | 'local_only';

export interface DefectRecord {
  id: string;
  uid: string;
  line: string;
  rawNote: string;
  maskedNote: string;
  imageDataUrl?: string;
  structured: StructuredDefect;
  maskedStructured: Omit<StructuredDefect, 'sensitiveSpans'>;
  confidential: boolean;
  maskingMap: Record<string, string>; // token -> original text, e.g. { "[CUSTOMER_1]": "ACME-77" }
  inferenceSource: InferenceSourceType;
  latencyMs: number;
  syncStatus: SyncStatus;
  blockedReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HybridLogEntry {
  id?: number;
  timestamp: string;
  task: 'structure_note' | 'analyze_root_causes' | 'translate_note' | 'device_check';
  requestedMode: string;
  actualSource: InferenceSourceType;
  ttftMs?: number;
  latencyMs: number;
  cloudBytes: number;
  blocked: boolean;
  reason?: string;
}

export interface ParetoItem {
  defectType: DefectType;
  count: number;
}

export interface Hypothesis {
  cause: string;
  evidenceRecordIds: string[];
  confidence: number;
}

export interface EightDReport {
  D1: string;
  D2: string;
  D3: string;
  D4: string;
  D5: string;
  D6: string;
  D7: string;
  D8: string;
}

export interface RootCauseAnalysis {
  id: string;
  recordIds: string[];
  pareto: ParetoItem[];
  hypotheses: Hypothesis[];
  eightD: EightDReport;
  nextChecks: string[];
  sentPayloadJson: string;
  inferenceSource: InferenceSourceType;
  latencyMs: number;
  createdAt: string;
}
