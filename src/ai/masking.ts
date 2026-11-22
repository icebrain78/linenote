import type { SensitiveKind, SensitiveSpan, StructuredDefect } from '../types';

export interface NewlyAssignedToken {
  token: string;
  original: string;
  kind: SensitiveKind;
}

export interface MaskingResult {
  maskedNote: string;
  maskedStructured: Omit<StructuredDefect, 'sensitiveSpans'>;
  maskingMap: Record<string, string>;
  newlyAssigned: NewlyAssignedToken[];
}

export interface GlobalTokenContext {
  valueToToken: Map<string, string>; // original -> token
  counters: Record<string, number>;
}

interface LocatedSpan {
  start: number;
  end: number;
  text: string;
  kind: SensitiveKind;
  priority: number; // 3 = CUSTOMER dictionary, 2 = regex pattern, 1 = AI model span
}

const KIND_PREFIX: Record<SensitiveKind, string> = {
  CUSTOMER: 'CUSTOMER',
  DRAWING_NO: 'DRAWING',
  PRICE: 'PRICE',
  PERSON: 'PERSON',
  OTHER: 'SENSITIVE',
};

function inferKindFromPattern(pattern: string): SensitiveKind {
  if (pattern.includes('₩') || pattern.includes('KRW') || pattern.includes('USD') || pattern.includes('\\$')) {
    return 'PRICE';
  }
  if (pattern.includes('CUST')) {
    return 'CUSTOMER';
  }
  if (pattern.includes('[A-Z]{2}-\\d')) {
    return 'DRAWING_NO';
  }
  return 'OTHER';
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rule-based pre-scan before AI inference.
 * Checks customer_names dictionary first, then regex patterns.
 */
export function detectRuleSensitiveSpans(
  text: string,
  patterns: string[],
  customerNames: string[]
): SensitiveSpan[] {
  if (!text) return [];
  const spans: SensitiveSpan[] = [];
  const seen = new Set<string>();

  for (const name of customerNames) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const regex = new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, 'gi');
    const matches = text.match(regex);
    if (matches) {
      for (const m of matches) {
        const key = `CUSTOMER:${m}`;
        if (!seen.has(key)) {
          seen.add(key);
          spans.push({ text: m, kind: 'CUSTOMER' });
        }
      }
    }
  }

  for (const pattern of patterns) {
    try {
      const regex = new RegExp(pattern, 'g');
      const matches = text.match(regex);
      if (matches) {
        const kind = inferKindFromPattern(pattern);
        for (const m of matches) {
          const key = `${kind}:${m}`;
          if (!seen.has(key)) {
            seen.add(key);
            spans.push({ text: m, kind });
          }
        }
      }
    } catch {
      // Ignore malformed regex from remote config
    }
  }

  return spans;
}

/**
 * Resolves overlapping spans by priority (higher wins), then longer span, then earlier start.
 */
function resolveNonOverlappingSpans(candidates: LocatedSpan[]): LocatedSpan[] {
  const sorted = [...candidates].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const lenDiff = (b.end - b.start) - (a.end - a.start);
    if (lenDiff !== 0) return lenDiff;
    return a.start - b.start;
  });

  const accepted: LocatedSpan[] = [];
  for (const cand of sorted) {
    const overlaps = accepted.some((acc) => cand.start < acc.end && cand.end > acc.start);
    if (!overlaps) {
      accepted.push(cand);
    }
  }

  // Sort ascending by start for deterministic token numbering
  return accepted.sort((a, b) => a.start - b.start);
}

function locateExactOccurrences(
  source: string,
  needle: string,
  kind: SensitiveKind,
  priority: number
): LocatedSpan[] {
  if (!source || !needle) return [];
  const results: LocatedSpan[] = [];
  let fromIndex = 0;
  while (fromIndex < source.length) {
    const idx = source.indexOf(needle, fromIndex);
    if (idx === -1) break;
    results.push({
      start: idx,
      end: idx + needle.length,
      text: needle,
      kind,
      priority,
    });
    fromIndex = idx + needle.length;
  }
  return results;
}

function replaceSpansFromEnd(
  text: string,
  spans: LocatedSpan[],
  valueToToken: Map<string, string>
): string {
  if (!text || spans.length === 0) return text;
  const desc = [...spans].sort((a, b) => b.start - a.start);
  let out = text;
  for (const sp of desc) {
    const token = valueToToken.get(sp.text);
    if (token) {
      out = out.slice(0, sp.start) + token + out.slice(sp.end);
    }
  }
  return out;
}

function collectSpansInText(
  text: string,
  ruleSpans: SensitiveSpan[],
  modelSpans: SensitiveSpan[]
): LocatedSpan[] {
  const candidates: LocatedSpan[] = [];

  for (const rs of ruleSpans) {
    const trimmed = rs.text?.trim();
    if (!trimmed) continue;
    const priority = rs.kind === 'CUSTOMER' ? 3 : 2;
    candidates.push(...locateExactOccurrences(text, trimmed, rs.kind, priority));
  }

  for (const ms of modelSpans) {
    const trimmed = ms.text?.trim();
    if (!trimmed) continue;
    candidates.push(...locateExactOccurrences(text, trimmed, ms.kind, 1));
  }

  return resolveNonOverlappingSpans(candidates);
}

export function buildGlobalTokenContext(
  entries: Array<{ token: string; original: string }>
): GlobalTokenContext {
  const valueToToken = new Map<string, string>();
  const counters: Record<string, number> = {};

  for (const { token, original } of entries) {
    if (!original || !token) continue;
    valueToToken.set(original, token);
    const match = token.match(/^\[([A-Z]+)_(\d+)\]$/);
    if (match) {
      const prefix = match[1];
      const num = parseInt(match[2], 10);
      if (Number.isFinite(num) && num > (counters[prefix] || 0)) {
        counters[prefix] = num;
      }
    }
  }

  return { valueToToken, counters };
}

/**
 * Masks sensitive spans in both the raw note and structured defect fields.
 * Uses {start, end, kind} span resolution (dictionary > regex > model),
 * deduplicates identical text to the same token (reusing globalCtx if provided),
 * and replaces once from the end.
 */
export function maskTextAndRecord(
  rawNote: string,
  structured: StructuredDefect,
  extraSpans: SensitiveSpan[] = [],
  globalCtx?: GlobalTokenContext
): MaskingResult {
  const modelSpans = (structured.sensitiveSpans || []).filter((s) => s.text && s.text.trim().length > 0);
  const ruleSpans = extraSpans.filter((s) => s.text && s.text.trim().length > 0);

  const noteSpans = collectSpansInText(rawNote, ruleSpans, modelSpans);

  const fieldTexts = [
    structured.part,
    structured.location,
    structured.suspectedCause,
    structured.immediateAction,
  ];
  const fieldSpansList = fieldTexts.map((ft) => collectSpansInText(ft, ruleSpans, modelSpans));

  const counters: Record<string, number> = globalCtx ? globalCtx.counters : {};
  const valueToToken = globalCtx ? globalCtx.valueToToken : new Map<string, string>();
  const maskingMap: Record<string, string> = {};
  const newlyAssigned: NewlyAssignedToken[] = [];

  const registerToken = (sp: LocatedSpan) => {
    let token = valueToToken.get(sp.text);
    if (!token) {
      const prefix = KIND_PREFIX[sp.kind] || 'SENSITIVE';
      counters[prefix] = (counters[prefix] || 0) + 1;
      token = `[${prefix}_${counters[prefix]}]`;
      valueToToken.set(sp.text, token);
      newlyAssigned.push({ token, original: sp.text, kind: sp.kind });
    }
    maskingMap[token] = sp.text;
  };

  noteSpans.forEach(registerToken);
  fieldSpansList.forEach((list) => list.forEach(registerToken));

  const maskedNote = replaceSpansFromEnd(rawNote, noteSpans, valueToToken);
  const [maskedPart, maskedLocation, maskedCause, maskedAction] = fieldTexts.map((ft, idx) =>
    replaceSpansFromEnd(ft, fieldSpansList[idx], valueToToken)
  );

  const maskedStructured: Omit<StructuredDefect, 'sensitiveSpans'> = {
    defectType: structured.defectType,
    part: maskedPart,
    location: maskedLocation,
    quantity: structured.quantity,
    severity: structured.severity,
    suspectedCause: maskedCause,
    immediateAction: maskedAction,
    confidence: structured.confidence,
  };

  return { maskedNote, maskedStructured, maskingMap, newlyAssigned };
}

/**
 * Masks any sensitive spans in a single string field using dictionary+regex and optional globalCtx.
 */
export function maskStringField(
  text: string,
  patterns: string[],
  customerNames: string[],
  globalCtx?: GlobalTokenContext
): string {
  if (!text) return text;
  const ruleSpans = detectRuleSensitiveSpans(text, patterns, customerNames);
  if (ruleSpans.length === 0) return text;

  const located = collectSpansInText(text, ruleSpans, []);
  const counters: Record<string, number> = globalCtx ? globalCtx.counters : {};
  const valueToToken = globalCtx ? globalCtx.valueToToken : new Map<string, string>();

  for (const sp of located) {
    if (!valueToToken.has(sp.text)) {
      const prefix = KIND_PREFIX[sp.kind] || 'SENSITIVE';
      counters[prefix] = (counters[prefix] || 0) + 1;
      valueToToken.set(sp.text, `[${prefix}_${counters[prefix]}]`);
    }
  }

  return replaceSpansFromEnd(text, located, valueToToken);
}

/**
 * Restores masked tokens back to original values for local UI display only.
 * Restored output must NEVER be persisted to cloud or sent to cloud models.
 */
export function restoreMaskedText(maskedText: string, maskingMap: Record<string, string>): string {
  if (!maskedText || !maskingMap) return maskedText;
  let out = maskedText;
  for (const [token, original] of Object.entries(maskingMap)) {
    out = out.replace(new RegExp(escapeRegExp(token), 'g'), original);
  }
  return out;
}

/**
 * Fail-closed verification before sending any payload to Cloud AI or Firestore.
 * Returns true if any sensitive pattern or customer name is still detected.
 */
export function hasResidualSensitiveData(
  serializedPayload: string,
  patterns: string[],
  customerNames: string[]
): boolean {
  const spans = detectRuleSensitiveSpans(serializedPayload, patterns, customerNames);
  return spans.length > 0;
}
