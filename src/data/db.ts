import Dexie, { type Table } from 'dexie';
import type {
  DefectRecord,
  GlobalTokenEntry,
  HybridLogEntry,
  RootCauseAnalysis,
  SensitiveSpan,
  StructuredDefect,
} from '../types';
import {
  buildGlobalTokenContext,
  detectRuleSensitiveSpans,
  maskTextAndRecord,
  type MaskingResult,
} from '../ai/masking';
import { getRemotePolicy } from '../firebase';

class LineNoteDatabase extends Dexie {
  records!: Table<DefectRecord, string>;
  hybridLogs!: Table<HybridLogEntry, number>;
  analyses!: Table<RootCauseAnalysis, string>;
  tokenMap!: Table<GlobalTokenEntry, string>;

  constructor() {
    super('LineNoteDB');
    this.version(1).stores({
      records: 'id, uid, line, syncStatus, createdAt',
      hybridLogs: '++id, timestamp, task, actualSource, blocked',
      analyses: 'id, createdAt',
    });
    this.version(2).stores({
      records: 'id, uid, line, syncStatus, createdAt',
      hybridLogs: '++id, timestamp, task, actualSource, blocked',
      analyses: 'id, createdAt',
      tokenMap: '&token, original, kind',
    });
  }
}

export const localDb = new LineNoteDatabase();

export async function addHybridLog(entry: Omit<HybridLogEntry, 'id' | 'timestamp'>): Promise<void> {
  await localDb.hybridLogs.add({
    ...entry,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Returns the device-local global token map (token -> original text).
 * Strictly stored only in IndexedDB.
 */
export async function getGlobalMaskingMap(): Promise<Record<string, string>> {
  const entries = await localDb.tokenMap.toArray();
  const map: Record<string, string> = {};
  for (const e of entries) {
    map[e.token] = e.original;
  }
  return map;
}

/**
 * Masks a note + structured defect using the persistent global token map,
 * persisting any newly assigned tokens into IndexedDB.
 */
export async function maskWithGlobalTokenMap(
  rawNote: string,
  structured: StructuredDefect,
  extraSpans: SensitiveSpan[] = [],
  persistNewTokens = true
): Promise<MaskingResult> {
  const entries = await localDb.tokenMap.toArray();
  const ctx = buildGlobalTokenContext(entries);
  const result = maskTextAndRecord(rawNote, structured, extraSpans, ctx);

  if (persistNewTokens && result.newlyAssigned.length > 0) {
    const now = new Date().toISOString();
    await localDb.tokenMap.bulkPut(
      result.newlyAssigned.map((t) => ({
        token: t.token,
        original: t.original,
        kind: t.kind,
        createdAt: now,
      }))
    );
  }

  return result;
}

/**
 * Migrates/re-masks all existing local records so they share the single global token map
 * (e.g., ACME-77 is always [CUSTOMER_1] across all records on this device).
 */
export async function migrateRecordsToGlobalTokenMap(): Promise<void> {
  const policy = getRemotePolicy();
  const allRecords = await localDb.records.orderBy('createdAt').toArray();
  if (allRecords.length === 0) return;

  for (const rec of allRecords) {
    const ruleSpans = detectRuleSensitiveSpans(
      rec.rawNote,
      policy.sensitivePatterns,
      policy.customerNames
    );
    const masked = await maskWithGlobalTokenMap(rec.rawNote, rec.structured, ruleSpans, true);
    const changed =
      rec.maskedNote !== masked.maskedNote ||
      JSON.stringify(rec.maskedStructured) !== JSON.stringify(masked.maskedStructured) ||
      JSON.stringify(rec.maskingMap) !== JSON.stringify(masked.maskingMap);

    if (changed) {
      await localDb.records.update(rec.id, {
        maskedNote: masked.maskedNote,
        maskedStructured: masked.maskedStructured,
        maskingMap: masked.maskingMap,
      });
    }
  }
}
