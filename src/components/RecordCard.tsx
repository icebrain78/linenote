import { useState } from 'react';
import { Lock, Languages, CheckCircle2, Clock, HardDrive } from 'lucide-react';
import type { DefectRecord, DefectType, Severity, StructuredDefect } from '../types';
import { SourceBadge } from './SourceBadge';
import { translateShortNote } from '../ai/models';

const DEFECT_TYPES: DefectType[] = [
  'SCRATCH',
  'DENT',
  'MISSING_TORQUE_MARK',
  'LOOSE_BOLT',
  'PAINT_DEFECT',
  'WRONG_PART',
  'DIMENSION_OUT',
  'WELD_DEFECT',
  'OTHER',
];

const SEVERITIES: Severity[] = ['CRITICAL', 'MAJOR', 'MINOR'];

interface EditableCardProps {
  structured: StructuredDefect;
  onChange: (updated: StructuredDefect) => void;
  inferenceSource: DefectRecord['inferenceSource'];
  latencyMs: number;
  maskingMap: Record<string, string>;
  maskedNote: string;
  quantityCorrected?: boolean;
  originalQuantity?: number;
}

export function EditableStructuredCard({
  structured,
  onChange,
  inferenceSource,
  latencyMs,
  maskingMap,
  maskedNote,
  quantityCorrected,
  originalQuantity,
}: EditableCardProps) {
  const maskedKeys = Object.keys(maskingMap);

  return (
    <div className="rounded-xl border-2 border-slate-300 bg-white p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <div>
          <h3 className="text-base font-bold text-slate-900">Review & Confirm Defect Record</h3>
          <p className="text-xs text-slate-600">
            Human-in-the-loop verification before saving to local storage
          </p>
        </div>
        <SourceBadge source={inferenceSource} latencyMs={latencyMs} />
      </div>

      {maskedKeys.length > 0 && (
        <div className="rounded-lg bg-amber-50 border border-amber-300 p-3 text-xs text-amber-950 space-y-1">
          <div className="flex items-center gap-1.5 font-bold">
            <Lock className="h-4 w-4 text-amber-700" />
            <span>Sensitive tokens detected & masked for cloud sync:</span>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {maskedKeys.map((token) => (
              <span
                key={token}
                className="inline-flex items-center rounded bg-amber-200/80 px-2 py-0.5 font-mono text-[11px] font-semibold"
              >
                {token} → 🔒 local only
              </span>
            ))}
          </div>
          <p className="text-slate-700 pt-1">
            <span className="font-semibold">Cloud-safe masked note:</span> {maskedNote}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold uppercase text-slate-700 mb-1">Defect Type</label>
          <select
            value={structured.defectType}
            onChange={(e) => onChange({ ...structured, defectType: e.target.value as DefectType })}
            className="w-full min-h-[48px] rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900"
          >
            {DEFECT_TYPES.map((dt) => (
              <option key={dt} value={dt}>
                {dt}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase text-slate-700 mb-1">Severity</label>
          <select
            value={structured.severity}
            onChange={(e) => onChange({ ...structured, severity: e.target.value as Severity })}
            className="w-full min-h-[48px] rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900"
          >
            {SEVERITIES.map((sev) => (
              <option key={sev} value={sev}>
                {sev}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase text-slate-700 mb-1">Part</label>
          <input
            type="text"
            value={structured.part}
            onChange={(e) => onChange({ ...structured, part: e.target.value })}
            className="w-full min-h-[48px] rounded-lg border border-slate-300 px-3 text-sm text-slate-900"
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase text-slate-700 mb-1">Location</label>
          <input
            type="text"
            value={structured.location}
            onChange={(e) => onChange({ ...structured, location: e.target.value })}
            className="w-full min-h-[48px] rounded-lg border border-slate-300 px-3 text-sm text-slate-900"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-bold uppercase text-slate-700">Quantity</label>
            {quantityCorrected && (
              <span className="rounded bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-900 border border-indigo-200">
                quantity corrected{originalQuantity !== undefined ? ` (AI: ${originalQuantity} → ${structured.quantity})` : ''}
              </span>
            )}
          </div>
          <input
            type="number"
            min={1}
            value={structured.quantity}
            onChange={(e) =>
              onChange({ ...structured, quantity: Math.max(1, parseInt(e.target.value || '1', 10)) })
            }
            className="w-full min-h-[48px] rounded-lg border border-slate-300 px-3 text-sm text-slate-900"
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
            AI Confidence ({Math.round(structured.confidence * 100)}%)
          </label>
          <div className="flex items-center min-h-[48px] px-3 rounded-lg bg-slate-100 text-sm font-mono text-slate-800">
            {structured.confidence.toFixed(2)}
          </div>
        </div>
      </div>

      <div>
        <label className="block text-xs font-bold uppercase text-slate-700 mb-1">Suspected Cause</label>
        <input
          type="text"
          value={structured.suspectedCause}
          onChange={(e) => onChange({ ...structured, suspectedCause: e.target.value })}
          className="w-full min-h-[48px] rounded-lg border border-slate-300 px-3 text-sm text-slate-900"
        />
      </div>

      <div>
        <label className="block text-xs font-bold uppercase text-slate-700 mb-1">Immediate Action</label>
        <input
          type="text"
          value={structured.immediateAction}
          onChange={(e) => onChange({ ...structured, immediateAction: e.target.value })}
          className="w-full min-h-[48px] rounded-lg border border-slate-300 px-3 text-sm text-slate-900"
        />
      </div>
    </div>
  );
}

interface RecordCardProps {
  record: DefectRecord;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}

export function RecordCard({ record, selected, onToggleSelect }: RecordCardProps) {
  const [translated, setTranslated] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);

  const severityColor =
    record.structured.severity === 'CRITICAL'
      ? 'bg-rose-100 text-rose-900 border-rose-300'
      : record.structured.severity === 'MAJOR'
      ? 'bg-amber-100 text-amber-900 border-amber-300'
      : 'bg-slate-100 text-slate-800 border-slate-300';

  const handleTranslate = async () => {
    if (translating) return;
    setTranslating(true);
    try {
      const res = await translateShortNote(record.rawNote);
      setTranslated(`${res.translated} (${res.source === 'on_device' ? 'On-device' : 'Cloud'} · ${res.latencyMs} ms)`);
    } catch {
      setTranslated('Translation unavailable offline without on-device model.');
    } finally {
      setTranslating(false);
    }
  };

  return (
    <div
      className={`rounded-xl border bg-white p-4 shadow-sm transition ${
        selected ? 'border-slate-900 ring-2 ring-slate-900/10' : 'border-slate-200'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(record.id)}
              aria-label={`Select record ${record.id}`}
              className="mt-1 h-6 w-6 rounded border-slate-400 text-slate-900 cursor-pointer"
            />
          )}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-bold text-slate-500">{record.line}</span>
              <span className={`rounded px-2 py-0.5 text-xs font-bold border ${severityColor}`}>
                {record.structured.severity}
              </span>
              <span className="rounded bg-slate-900 px-2 py-0.5 text-xs font-bold text-white">
                {record.structured.defectType}
              </span>
              {record.confidential && (
                <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                  <Lock className="h-3 w-3" /> Confidential
                </span>
              )}
            </div>
            <h4 className="mt-1.5 text-sm font-bold text-slate-900">
              {record.structured.part} — {record.structured.location} (Qty: {record.structured.quantity})
            </h4>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <SourceBadge source={record.inferenceSource} latencyMs={record.latencyMs} />
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600">
            {record.syncStatus === 'synced' ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Masked Synced
              </>
            ) : record.syncStatus === 'pending' ? (
              <>
                <Clock className="h-3.5 w-3.5 text-amber-600" /> Sync Queued
              </>
            ) : (
              <>
                <HardDrive className="h-3.5 w-3.5 text-slate-500" /> Local Only
              </>
            )}
          </span>
        </div>
      </div>

      <p className="mt-2.5 text-sm text-slate-800 bg-slate-50 rounded-lg p-2.5 border border-slate-200">
        {record.rawNote}
      </p>

      {translated && (
        <p className="mt-2 text-xs text-sky-900 bg-sky-50 rounded-lg p-2 border border-sky-200">
          {translated}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <div className="flex items-center gap-3">
          <span>{new Date(record.createdAt).toLocaleString()}</span>
          {Object.keys(record.maskingMap).length > 0 && (
            <span className="font-mono text-amber-800">
              Masked for cloud: {Object.keys(record.maskingMap).join(', ')}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleTranslate}
          disabled={translating}
          style={{ minHeight: '36px' }}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
        >
          <Languages className="h-3.5 w-3.5" />
          <span>{translating ? 'Translating...' : 'KO ↔ EN'}</span>
        </button>
      </div>
    </div>
  );
}
