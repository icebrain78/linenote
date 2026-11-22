import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { db, ensureAnonymousAuth, getRemotePolicy, isFirebaseConfigured } from '../firebase';
import { buildGlobalTokenContext } from '../ai/masking';
import { sanitizeAndGuardCloudRecord } from '../ai/router';
import type { DefectRecord } from '../types';
import { localDb } from './db';

/**
 * Syncs ONLY the masked representation of a DefectRecord to Cloud Firestore.
 * Raw notes, photos, and maskingMap are NEVER uploaded.
 * Runs sanitizeAndGuardCloudRecord fail-closed check before writing.
 */
export async function syncMaskedRecord(record: DefectRecord): Promise<'synced' | 'local_only' | 'pending'> {
  if (!isFirebaseConfigured || !db) {
    return 'local_only';
  }

  const user = await ensureAnonymousAuth();
  if (!user) {
    return 'pending';
  }

  const policy = getRemotePolicy();
  const entries = await localDb.tokenMap.toArray();
  const globalCtx = buildGlobalTokenContext(entries);

  const check = sanitizeAndGuardCloudRecord(
    {
      id: record.id,
      line: record.line,
      maskedNote: record.maskedNote,
      defectType: record.maskedStructured.defectType,
      part: record.maskedStructured.part,
      location: record.maskedStructured.location,
      quantity: record.maskedStructured.quantity,
      severity: record.maskedStructured.severity,
      suspectedCause: record.maskedStructured.suspectedCause,
      immediateAction: record.maskedStructured.immediateAction,
      createdAt: record.createdAt,
    },
    policy,
    globalCtx
  );

  if (!check.allowed || !check.sanitizedRecord) {
    console.error('Sync blocked by fail-closed guard:', check.blockedReason);
    await localDb.records.update(record.id, {
      syncStatus: 'local_only',
      blockedReason: check.blockedReason,
    });
    return 'local_only';
  }

  const maskedDoc = {
    id: record.id,
    uid: user.uid,
    line: check.sanitizedRecord.line,
    maskedNote: check.sanitizedRecord.maskedNote,
    maskedStructured: {
      defectType: record.maskedStructured.defectType,
      part: check.sanitizedRecord.part,
      location: check.sanitizedRecord.location,
      quantity: record.maskedStructured.quantity,
      severity: record.maskedStructured.severity,
      suspectedCause: check.sanitizedRecord.suspectedCause,
      immediateAction: check.sanitizedRecord.immediateAction || '',
      confidence: record.maskedStructured.confidence,
    },
    confidential: record.confidential,
    inferenceSource: record.inferenceSource,
    latencyMs: record.latencyMs,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };

  if (!navigator.onLine) {
    // Firestore persistentLocalCache queues writes offline; mark pending until online ack
    setDoc(doc(db, 'users', user.uid, 'records', record.id), maskedDoc).catch((err) => {
      console.warn('Queued offline Firestore write warning:', err);
    });
    return 'pending';
  }

  try {
    await setDoc(doc(db, 'users', user.uid, 'records', record.id), maskedDoc);
    await localDb.records.update(record.id, { uid: user.uid, syncStatus: 'synced' });
    return 'synced';
  } catch (err) {
    console.warn('Firestore sync deferred (offline, rules, or App Check pending):', err);
    return 'pending';
  }
}

export async function flushPendingSyncs(): Promise<number> {
  if (!navigator.onLine || !isFirebaseConfigured || !db) return 0;
  const pending = await localDb.records.where('syncStatus').equals('pending').toArray();
  let syncedCount = 0;
  for (const rec of pending) {
    const status = await syncMaskedRecord(rec);
    if (status === 'synced') syncedCount++;
  }
  return syncedCount;
}

/**
 * Loads records from local IndexedDB and merges any masked records stored in Firestore
 * (preserving local rawNote/maskingMap when already present locally).
 */
export async function loadAllAvailableRecords(): Promise<DefectRecord[]> {
  const localRecords = await localDb.records.orderBy('createdAt').reverse().toArray();
  const byId = new Map<string, DefectRecord>(localRecords.map((r) => [r.id, r]));

  if (isFirebaseConfigured && db) {
    try {
      const user = await ensureAnonymousAuth();
      if (user) {
        const snap = await getDocs(collection(db, 'users', user.uid, 'records'));
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          if (!byId.has(docSnap.id) && d.maskedStructured) {
            byId.set(docSnap.id, {
              id: docSnap.id,
              uid: d.uid || user.uid,
              line: d.line || 'Unknown Line',
              rawNote: d.maskedNote || '',
              maskedNote: d.maskedNote || '',
              structured: { ...d.maskedStructured, sensitiveSpans: [] },
              maskedStructured: d.maskedStructured,
              confidential: Boolean(d.confidential),
              maskingMap: {},
              inferenceSource: d.inferenceSource || 'none',
              latencyMs: d.latencyMs || 0,
              syncStatus: 'synced',
              createdAt: d.createdAt || new Date().toISOString(),
              updatedAt: d.updatedAt || new Date().toISOString(),
            });
          }
        });
      }
    } catch (err) {
      console.warn('Firestore fetch skipped (offline or unavailable):', err);
    }
  }

  return Array.from(byId.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
