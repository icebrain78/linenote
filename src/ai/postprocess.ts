import type { StructuredDefect } from '../types';

export interface PostProcessResult {
  structured: StructuredDefect;
  quantityCorrected: boolean;
  originalQuantity: number;
  extractedQuantity: number | null;
}

const QTY_PATTERNS: RegExp[] = [
  /(?:^|[\s,;(]|(?<=\d))[x×]\s*(\d{1,4})\b/i,
  /\bqty[:\s]*(\d{1,4})\b/i,
  /\b(\d{1,4})\s*(?:ea\b|pcs?\b|units?\b|개|대)/i,
];

const PART_STRIP_PATTERNS: RegExp[] = [
  /(?:^|[\s,;(]|(?<=\d))[x×]\s*\d{1,4}\b/gi,
  /\bqty[:\s]*\d{1,4}\b/gi,
  /\b\d{1,4}\s*(?:ea\b|pcs?\b|units?\b|개|대)/gi,
];

/**
 * Extracts an explicit quantity from the operator's raw note using deterministic regexes.
 */
export function extractQuantityFromNote(rawNote: string): number | null {
  if (!rawNote) return null;
  for (const pattern of QTY_PATTERNS) {
    const match = rawNote.match(pattern);
    if (match && match[1]) {
      const parsed = parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  return null;
}

/**
 * Strips inline quantity expressions (e.g. "x4", "4 pcs") from the extracted part name.
 */
export function stripQuantityFromPart(part: string): string {
  if (!part) return part;
  let cleaned = part;
  for (const pattern of PART_STRIP_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned.replace(/\s{2,}/g, ' ').replace(/^[\s,-]+|[\s,-]+$/g, '').trim();
}

/**
 * Deterministic post-processor for AI-structured defect records:
 * 1. Validates/overrides quantity against explicit quantities in the raw note.
 * 2. Strips redundant quantity tokens from the part field.
 */
export function postProcessStructuredDefect(
  rawNote: string,
  structured: StructuredDefect
): PostProcessResult {
  const originalQuantity = structured.quantity;
  const extractedQuantity = extractQuantityFromNote(rawNote);
  const quantityCorrected =
    extractedQuantity !== null && extractedQuantity !== structured.quantity;

  const cleanedPart = stripQuantityFromPart(structured.part) || structured.part;

  return {
    structured: {
      ...structured,
      part: cleanedPart,
      quantity: quantityCorrected ? extractedQuantity! : structured.quantity,
    },
    quantityCorrected,
    originalQuantity,
    extractedQuantity,
  };
}
