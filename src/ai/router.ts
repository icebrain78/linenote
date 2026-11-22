import { InferenceMode } from 'firebase/ai';
import type { RemotePolicyConfig } from '../firebase';
import type { SensitiveSpan } from '../types';
import {
  detectRuleSensitiveSpans,
  hasResidualSensitiveData,
  maskStringField,
  type GlobalTokenContext,
} from './masking';

export interface RouteDecision {
  mode: InferenceMode;
  isSensitive: boolean;
  detectedSpans: SensitiveSpan[];
  reason: string;
}

/**
 * Sensitivity Router (M3):
 * Decides per request where AI inference is allowed to run based on
 * data-governance policy (not just network/device availability).
 */
export function decideInferenceRoute(
  noteText: string,
  confidentialToggle: boolean,
  policy: RemotePolicyConfig
): RouteDecision {
  const detectedSpans = detectRuleSensitiveSpans(
    noteText,
    policy.sensitivePatterns,
    policy.customerNames
  );

  if (confidentialToggle) {
    return {
      mode: InferenceMode.ONLY_ON_DEVICE,
      isSensitive: true,
      detectedSpans,
      reason: 'User enabled Confidential lock (ONLY_ON_DEVICE enforced)',
    };
  }

  if (detectedSpans.length > 0) {
    return {
      mode: InferenceMode.ONLY_ON_DEVICE,
      isSensitive: true,
      detectedSpans,
      reason: `Detected sensitive data (${detectedSpans.map((s) => s.kind).join(', ')}) -> ONLY_ON_DEVICE enforced`,
    };
  }

  const configuredMode =
    policy.structurerMode === InferenceMode.ONLY_ON_DEVICE
      ? InferenceMode.ONLY_ON_DEVICE
      : InferenceMode.PREFER_ON_DEVICE;

  return {
    mode: configuredMode,
    isSensitive: false,
    detectedSpans: [],
    reason: 'No sensitive patterns detected -> PREFER_ON_DEVICE (cloud fallback allowed)',
  };
}

export interface CloudGuardResult {
  allowed: boolean;
  blockedReason?: string;
}

/**
 * Fail-closed guard executed immediately before any cloud model or Firestore call.
 * Blocks transmission if any unmasked sensitive pattern remains.
 */
export function guardCloudPayload(
  serializedPayload: string,
  policy: RemotePolicyConfig
): CloudGuardResult {
  if (hasResidualSensitiveData(serializedPayload, policy.sensitivePatterns, policy.customerNames)) {
    return {
      allowed: false,
      blockedReason:
        'Fail-closed block: Residual sensitive pattern detected in cloud payload. Transmission aborted.',
    };
  }
  return { allowed: true };
}

export interface CloudSafeRecordFields {
  id: string;
  line: string;
  maskedNote: string;
  defectType: string;
  part: string;
  location: string;
  quantity: number;
  severity: string;
  suspectedCause: string;
  immediateAction?: string;
  createdAt: string;
}

export interface SanitizeAndGuardResult {
  allowed: boolean;
  sanitizedRecord?: CloudSafeRecordFields;
  blockedReason?: string;
}

/**
 * Scans ALL string fields (maskedNote, part, location, suspectedCause, immediateAction, line)
 * with dictionary+regex, replaces matches with tokens, and runs a fail-closed check.
 */
export function sanitizeAndGuardCloudRecord(
  record: CloudSafeRecordFields,
  policy: RemotePolicyConfig,
  globalCtx?: GlobalTokenContext
): SanitizeAndGuardResult {
  const mask = (val?: string) =>
    val ? maskStringField(val, policy.sensitivePatterns, policy.customerNames, globalCtx) : val;

  const sanitizedRecord: CloudSafeRecordFields = {
    ...record,
    line: mask(record.line) || '',
    maskedNote: mask(record.maskedNote) || '',
    part: mask(record.part) || '',
    location: mask(record.location) || '',
    suspectedCause: mask(record.suspectedCause) || '',
    ...(record.immediateAction !== undefined
      ? { immediateAction: mask(record.immediateAction) || '' }
      : {}),
  };

  const guard = guardCloudPayload(JSON.stringify(sanitizedRecord), policy);
  if (!guard.allowed) {
    return {
      allowed: false,
      blockedReason: guard.blockedReason,
    };
  }

  return {
    allowed: true,
    sanitizedRecord,
  };
}
