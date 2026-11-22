import { describe, expect, it } from 'vitest';
import { InferenceMode } from 'firebase/ai';
import {
  buildGlobalTokenContext,
  detectRuleSensitiveSpans,
  maskTextAndRecord,
  restoreMaskedText,
  hasResidualSensitiveData,
} from './masking';
import { decideInferenceRoute, guardCloudPayload, sanitizeAndGuardCloudRecord } from './router';
import { extractQuantityFromNote, postProcessStructuredDefect } from './postprocess';
import type { RemotePolicyConfig } from '../firebase';
import type { StructuredDefect } from '../types';

const TEST_POLICY: RemotePolicyConfig = {
  sensitivePatterns: [
    '\\b[A-Z]{2}-\\d{3,5}\\b',
    '(₩|\\$|KRW|USD)\\s?\\d[\\d,.]*',
    '\\bCUST-[A-Z0-9]{2,8}\\b',
  ],
  customerNames: ['ACME-77', 'Apex Enclosure', 'Nordic Rack'],
  structurerMode: 'prefer_on_device',
  cloudModel: 'gemini-3.5-flash-lite',
};

describe('M3 Sensitivity Router & Masking (Fail-closed Governance)', () => {
  it('forces ONLY_ON_DEVICE when customer name or drawing number is detected', () => {
    const note = 'Bolt mark missing on M8 x4, left door hinge, cust ACME-77 drawing EN-2231';
    const decision = decideInferenceRoute(note, false, TEST_POLICY);

    expect(decision.mode).toBe(InferenceMode.ONLY_ON_DEVICE);
    expect(decision.isSensitive).toBe(true);
    expect(decision.detectedSpans.map((s) => s.text)).toContain('ACME-77');
    expect(decision.detectedSpans.map((s) => s.text)).toContain('EN-2231');
  });

  it('forces ONLY_ON_DEVICE when user enables Confidential toggle even without regex match', () => {
    const note = 'Minor scratch on front panel door, 2 units';
    const decision = decideInferenceRoute(note, true, TEST_POLICY);

    expect(decision.mode).toBe(InferenceMode.ONLY_ON_DEVICE);
    expect(decision.isSensitive).toBe(true);
  });

  it('allows PREFER_ON_DEVICE for non-sensitive notes', () => {
    const note = 'Paint peel near bottom corner of enclosure door, qty 1';
    const decision = decideInferenceRoute(note, false, TEST_POLICY);

    expect(decision.mode).toBe(InferenceMode.PREFER_ON_DEVICE);
    expect(decision.isSensitive).toBe(false);
    expect(decision.detectedSpans).toHaveLength(0);
  });

  it('masks sensitive spans deterministically and restores them locally', () => {
    const rawNote = 'Bolt mark missing on M8 x4, cust ACME-77 drawing EN-2231 unit cost $450';
    const structured: StructuredDefect = {
      defectType: 'MISSING_TORQUE_MARK',
      part: 'hinge bolt M8 (EN-2231)',
      location: 'left door hinge',
      quantity: 4,
      severity: 'MAJOR',
      suspectedCause: 'Torque wrench skipped on ACME-77 batch',
      immediateAction: 'Re-torque and mark',
      sensitiveSpans: [{ text: 'ACME-77', kind: 'CUSTOMER' }],
      confidence: 0.92,
    };

    const ruleSpans = detectRuleSensitiveSpans(rawNote, TEST_POLICY.sensitivePatterns, TEST_POLICY.customerNames);
    const { maskedNote, maskedStructured, maskingMap } = maskTextAndRecord(rawNote, structured, ruleSpans);

    expect(maskedNote).not.toContain('ACME-77');
    expect(maskedNote).not.toContain('EN-2231');
    expect(maskedNote).not.toContain('$450');
    expect(maskedStructured.part).not.toContain('EN-2231');
    expect(maskedStructured.suspectedCause).not.toContain('ACME-77');

    // Verify fail-closed cloud guard passes on masked payload
    const maskedPayload = JSON.stringify({ maskedNote, maskedStructured });
    expect(hasResidualSensitiveData(maskedPayload, TEST_POLICY.sensitivePatterns, TEST_POLICY.customerNames)).toBe(false);
    expect(guardCloudPayload(maskedPayload, TEST_POLICY).allowed).toBe(true);

    // Verify local restoration works for UI display
    const restored = restoreMaskedText(maskedNote, maskingMap);
    expect(restored).toBe(rawNote);
  });

  it('blocks cloud transmission (fail-closed) if any sensitive pattern leaks into payload', () => {
    const leakyPayload = JSON.stringify({
      part: 'hinge bolt',
      note: 'Still contains drawing EN-9901 and ACME-77',
    });

    const guard = guardCloudPayload(leakyPayload, TEST_POLICY);
    expect(guard.allowed).toBe(false);
    expect(guard.blockedReason).toContain('Fail-closed block');
  });

  it('prioritizes customer_names dictionary over AI span kind (ACME-77 -> [CUSTOMER_1], EN-2231 -> [DRAWING_1])', () => {
    const rawNote = 'Bolt mark missing on M8 x4, left door hinge, cust ACME-77 drawing EN-2231';
    const structured: StructuredDefect = {
      defectType: 'MISSING_TORQUE_MARK',
      part: 'M8 Bolt',
      location: 'left door hinge',
      quantity: 4,
      severity: 'MAJOR',
      suspectedCause: 'Missed torque mark',
      immediateAction: 'Re-torque',
      // Simulate AI returning overlapping/corrupted spans and misclassifying ACME-77
      sensitiveSpans: [
        { text: 'ACME-77 drawing EN-2231', kind: 'DRAWING_NO' },
        { text: 'ACME-77', kind: 'DRAWING_NO' },
        { text: 'EN-2231', kind: 'DRAWING_NO' },
      ],
      confidence: 0.95,
    };

    const ruleSpans = detectRuleSensitiveSpans(
      rawNote,
      TEST_POLICY.sensitivePatterns,
      TEST_POLICY.customerNames
    );
    const { maskedNote, maskingMap } = maskTextAndRecord(rawNote, structured, ruleSpans);

    expect(maskedNote).toBe(
      'Bolt mark missing on M8 x4, left door hinge, cust [CUSTOMER_1] drawing [DRAWING_1]'
    );
    expect(Object.keys(maskingMap)).toHaveLength(2);
    expect(maskingMap['[CUSTOMER_1]']).toBe('ACME-77');
    expect(maskingMap['[DRAWING_1]']).toBe('EN-2231');
  });

  it('deterministically corrects AI quantity from regex and strips quantity from part name', () => {
    const rawNote = 'Bolt mark missing on M8 x4, left door hinge, cust ACME-77 drawing EN-2231';
    const aiOutput: StructuredDefect = {
      defectType: 'MISSING_TORQUE_MARK',
      part: 'M8 x4 Bolt',
      location: 'left door hinge',
      quantity: 1,
      severity: 'MINOR',
      suspectedCause: 'Failure to apply proper torque mark',
      immediateAction: 'Inspect and apply mark',
      sensitiveSpans: [],
      confidence: 0.95,
    };

    const post = postProcessStructuredDefect(rawNote, aiOutput);
    expect(post.quantityCorrected).toBe(true);
    expect(post.originalQuantity).toBe(1);
    expect(post.structured.quantity).toBe(4);
    expect(post.structured.part).toBe('M8 Bolt');

    expect(extractQuantityFromNote('Bracket ×6 loose')).toBe(6);
    expect(extractQuantityFromNote('Washer 12ea missing')).toBe(12);
    expect(extractQuantityFromNote('Scratch on 5 pcs')).toBe(5);
    expect(extractQuantityFromNote('도어 스크래치 2개 발생')).toBe(2);
    expect(extractQuantityFromNote('Scratch on front door, qty 3')).toBe(3);
  });

  it('maintains a global token map across multiple records (ACME-77=[CUSTOMER_1], Apex Enclosure=[CUSTOMER_2])', () => {
    const globalCtx = buildGlobalTokenContext([]);
    const dummyStructured: StructuredDefect = {
      defectType: 'MISSING_TORQUE_MARK',
      part: 'M8 bolt',
      location: 'left door hinge',
      quantity: 4,
      severity: 'MAJOR',
      suspectedCause: 'Missed mark',
      immediateAction: 'Mark bolt',
      sensitiveSpans: [],
      confidence: 0.9,
    };

    const note1 = 'Missing mark for ACME-77 drawing EN-2231';
    const spans1 = detectRuleSensitiveSpans(note1, TEST_POLICY.sensitivePatterns, TEST_POLICY.customerNames);
    const res1 = maskTextAndRecord(note1, dummyStructured, spans1, globalCtx);
    expect(res1.maskedNote).toBe('Missing mark for [CUSTOMER_1] drawing [DRAWING_1]');

    const note2 = 'Loose bolt for Apex Enclosure and ACME-77 drawing EN-4410';
    const spans2 = detectRuleSensitiveSpans(note2, TEST_POLICY.sensitivePatterns, TEST_POLICY.customerNames);
    const res2 = maskTextAndRecord(note2, dummyStructured, spans2, globalCtx);
    expect(res2.maskedNote).toBe('Loose bolt for [CUSTOMER_2] and [CUSTOMER_1] drawing [DRAWING_2]');
  });

  it('sanitizes all cloud record fields including suspectedCause containing ACME-77', () => {
    const globalCtx = buildGlobalTokenContext([{ token: '[CUSTOMER_1]', original: 'ACME-77' }]);
    const dirtyRecord = {
      id: 'rec_dirty_1',
      line: 'Door Hinge Assembly #3',
      maskedNote: 'Bolt mark missing',
      defectType: 'MISSING_TORQUE_MARK',
      part: 'M8 bolt',
      location: 'left door hinge',
      quantity: 4,
      severity: 'MAJOR',
      suspectedCause: 'Torque wrench skipped on ACME-77 batch EN-2231',
      immediateAction: 'Notify ACME-77 supervisor',
      createdAt: '2026-11-23T00:00:00.000Z',
    };

    const result = sanitizeAndGuardCloudRecord(dirtyRecord, TEST_POLICY, globalCtx);
    expect(result.allowed).toBe(true);
    expect(result.sanitizedRecord?.suspectedCause).toBe('Torque wrench skipped on [CUSTOMER_1] batch [DRAWING_1]');
    expect(result.sanitizedRecord?.immediateAction).toBe('Notify [CUSTOMER_1] supervisor');
    expect(JSON.stringify(result.sanitizedRecord)).not.toContain('ACME-77');
    expect(JSON.stringify(result.sanitizedRecord)).not.toContain('EN-2231');
  });
});
