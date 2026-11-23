import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Lock, Unlock, Mic, Sparkles, Save, AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react';
import { InferenceMode } from 'firebase/ai';
import { getRemotePolicy, auth } from '../firebase';
import { decideInferenceRoute } from '../ai/router';
import { detectRuleSensitiveSpans } from '../ai/masking';
import { structureDefectNote } from '../ai/models';
import { localDb, maskWithGlobalTokenMap } from '../data/db';
import { syncMaskedRecord } from '../data/sync';
import { resizeImageToJpeg } from '../utils/image';
import type { DefectRecord, InferenceSourceType, SensitiveSpan, StructuredDefect } from '../types';
import { EditableStructuredCard } from '../components/RecordCard';

const LINES = [
  'Enclosure Welding #2',
  'Door Hinge Assembly #3',
  'Sheet Metal Bending #1',
  'Powder Coating Line A',
  'Final QC Station',
];

export function Capture() {
  const [line, setLine] = useState(LINES[1]);
  const [rawNote, setRawNote] = useState('');
  const [confidential, setConfidential] = useState(false);
  const [imageDataUrl, setImageDataUrl] = useState<string | undefined>();
  const [processing, setProcessing] = useState(false);
  const [streamingPreview, setStreamingPreview] = useState('');
  const [streamingTtftMs, setStreamingTtftMs] = useState<number | undefined>();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [blockedPayload, setBlockedPayload] = useState<{
    rawNote: string;
    line: string;
    imageDataUrl?: string;
    detectedSpans: SensitiveSpan[];
    reason: string;
  } | null>(null);
  const [savedBanner, setSavedBanner] = useState<string | null>(null);

  const [draftResult, setDraftResult] = useState<{
    structured: StructuredDefect;
    maskedNote: string;
    maskedStructured: Omit<StructuredDefect, 'sensitiveSpans'>;
    maskingMap: Record<string, string>;
    source: InferenceSourceType;
    latencyMs: number;
    isSensitive: boolean;
    quantityCorrected: boolean;
    originalQuantity: number;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [listening, setListening] = useState(false);

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const resized = await resizeImageToJpeg(file, 1024);
      setImageDataUrl(resized);
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to process image.');
    }
  };

  const handleDictate = () => {
    if (confidential) return;
    const win = window as unknown as {
      SpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
        onerror: () => void;
        onend: () => void;
        start: () => void;
      };
      webkitSpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
        onerror: () => void;
        onend: () => void;
        start: () => void;
      };
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) {
      setErrorMsg('Web Speech API is not supported in this browser.');
      return;
    }
    const rec = new SpeechRec();
    rec.lang = 'en-US';
    rec.interimResults = false;
    setListening(true);
    rec.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript || '';
      setRawNote((prev) => `${prev ? prev + ' ' : ''}${transcript}`.slice(0, 500));
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    rec.start();
  };

  const handleStructure = async () => {
    if (!rawNote.trim()) {
      setErrorMsg('Please enter a defect note first.');
      return;
    }
    setProcessing(true);
    setDraftResult(null);
    setBlockedPayload(null);
    setStreamingPreview('');
    setStreamingTtftMs(undefined);
    setErrorMsg(null);
    setSavedBanner(null);

    const policy = getRemotePolicy();
    const route = decideInferenceRoute(rawNote, confidential, policy);

    try {
      const res = await structureDefectNote({
        noteText: rawNote,
        line,
        imageDataUrl,
        mode: route.mode,
        onToken: (partial, ttft) => {
          setStreamingPreview(partial);
          if (ttft !== undefined) setStreamingTtftMs(ttft);
        },
      });

      const masked = await maskWithGlobalTokenMap(rawNote, res.structured, route.detectedSpans, false);
      setDraftResult({
        structured: res.structured,
        maskedNote: masked.maskedNote,
        maskedStructured: masked.maskedStructured,
        maskingMap: masked.maskingMap,
        source: res.source,
        latencyMs: res.latencyMs,
        isSensitive: route.isSensitive || Object.keys(masked.maskingMap).length > 0,
        quantityCorrected: res.quantityCorrected,
        originalQuantity: res.originalQuantity,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDraftResult(null);
      if (route.mode === InferenceMode.ONLY_ON_DEVICE || /block/i.test(message)) {
        setErrorMsg(null);
        setBlockedPayload({
          rawNote,
          line,
          imageDataUrl,
          detectedSpans: route.detectedSpans,
          reason: message,
        });
      } else {
        setBlockedPayload(null);
        setErrorMsg(message);
      }
    } finally {
      setProcessing(false);
    }
  };

  const handleSaveBlockedLocally = async () => {
    if (!blockedPayload) return;
    const fallbackStructured: StructuredDefect = {
      defectType: 'OTHER',
      part: 'Unstructured',
      location: 'Unspecified',
      quantity: 1,
      severity: 'MAJOR',
      suspectedCause: 'Pending manual classification',
      immediateAction: 'Saved locally without AI',
      sensitiveSpans: blockedPayload.detectedSpans,
      confidence: 0,
    };
    const masked = await maskWithGlobalTokenMap(
      blockedPayload.rawNote,
      fallbackStructured,
      blockedPayload.detectedSpans,
      true
    );
    const id = `rec_${Date.now()}`;
    const now = new Date().toISOString();
    await localDb.records.add({
      id,
      uid: auth?.currentUser?.uid || 'local',
      line: blockedPayload.line,
      rawNote: blockedPayload.rawNote,
      maskedNote: masked.maskedNote,
      imageDataUrl: blockedPayload.imageDataUrl,
      structured: fallbackStructured,
      maskedStructured: masked.maskedStructured,
      confidential: true,
      maskingMap: masked.maskingMap,
      inferenceSource: 'none',
      latencyMs: 0,
      syncStatus: 'local_only',
      blockedReason: blockedPayload.reason,
      createdAt: now,
      updatedAt: now,
    });
    setBlockedPayload(null);
    setSavedBanner('Saved locally without AI (never sent to cloud).');
    setRawNote('');
    setImageDataUrl(undefined);
    setConfidential(false);
  };

  const handleSaveConfirmed = async () => {
    if (!draftResult) return;
    const policy = getRemotePolicy();
    const ruleSpans = detectRuleSensitiveSpans(rawNote, policy.sensitivePatterns, policy.customerNames);
    const masked = await maskWithGlobalTokenMap(rawNote, draftResult.structured, ruleSpans, true);
    const id = `rec_${Date.now()}`;
    const now = new Date().toISOString();

    const record: DefectRecord = {
      id,
      uid: auth?.currentUser?.uid || 'local',
      line,
      rawNote,
      maskedNote: masked.maskedNote,
      imageDataUrl,
      structured: draftResult.structured,
      maskedStructured: masked.maskedStructured,
      confidential: confidential || draftResult.isSensitive,
      maskingMap: masked.maskingMap,
      inferenceSource: draftResult.source,
      latencyMs: draftResult.latencyMs,
      syncStatus: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    await localDb.records.add(record);
    const syncStatus = await syncMaskedRecord(record);

    setSavedBanner(
      syncStatus === 'synced'
        ? 'Defect saved locally & masked record synced to Cloud Firestore.'
        : 'Defect saved locally (IndexedDB). Masked sync queued.'
    );
    setRawNote('');
    setImageDataUrl(undefined);
    setDraftResult(null);
    setConfidential(false);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Floor Defect Capture</h2>
            <p className="text-xs text-slate-600">
              Sensitive customer, drawing, and price data stay strictly on-device.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[
              {
                label: '1. Confidential (Bolt)',
                line: 'Door Hinge Assembly #3',
                note: 'Bolt mark missing on M8 x4, left door hinge, cust ACME-77 drawing EN-2231',
                sensitive: true,
              },
              {
                label: '2. Confidential (Price)',
                line: 'Sheet Metal Bending #1',
                note: 'Flange angle 92 deg instead of 90 deg on drawing EN-4410, unit cost $320, qty 5',
                sensitive: true,
              },
              {
                label: '3. Paint Peel',
                line: 'Powder Coating Line A',
                note: 'Orange peel paint defect on front enclosure panel, qty 2, minor cosmetic',
                sensitive: false,
              },
              {
                label: '4. Weld Spatter',
                line: 'Enclosure Welding #2',
                note: 'Heavy weld spatter along bottom base flange seam, qty 3 enclosures',
                sensitive: false,
              },
              {
                label: '5. Scratch (KO)',
                line: 'Final QC Station',
                note: '도어 좌측 상단 스크래치 15cm 발생, 1대, 경미',
                sensitive: false,
              },
            ].map((s) => (
              <button
                key={s.label}
                type="button"
                style={{ minHeight: '36px' }}
                onClick={() => {
                  setLine(s.line);
                  setRawNote(s.note);
                  setConfidential(s.sensitive);
                  setErrorMsg(null);
                  setSavedBanner(null);
                }}
                className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                  s.sensitive
                    ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                    : 'border-slate-300 bg-slate-50 text-slate-800 hover:bg-slate-100'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Line Selector */}
        <div>
          <label className="block text-xs font-bold uppercase text-slate-700 mb-1.5">
            Line / Process
          </label>
          <select
            value={line}
            onChange={(e) => setLine(e.target.value)}
            className="w-full min-h-[48px] rounded-lg border border-slate-300 bg-white px-3 text-base font-medium text-slate-900"
          >
            {LINES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        {/* Note Textarea */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs font-bold uppercase text-slate-700">
              Defect Note ({rawNote.length}/500)
            </label>
            <button
              type="button"
              onClick={handleDictate}
              disabled={confidential || listening}
              style={{ minHeight: '36px' }}
              title={
                confidential
                  ? 'Voice dictation disabled in Confidential mode (browser speech may use cloud)'
                  : 'Dictate note via microphone'
              }
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-semibold border ${
                confidential
                  ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                  : listening
                  ? 'border-rose-300 bg-rose-100 text-rose-800'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Mic className="h-3.5 w-3.5" />
              <span>{listening ? 'Listening...' : 'Dictate'}</span>
            </button>
          </div>
          <textarea
            value={rawNote}
            onChange={(e) => setRawNote(e.target.value.slice(0, 500))}
            rows={3}
            placeholder="e.g., Bolt mark missing on M8 x4, left door hinge, cust ACME-77 drawing EN-2231"
            className="w-full rounded-xl border border-slate-300 p-3.5 text-base text-slate-900 focus:border-slate-900 focus:outline-none"
          />
        </div>

        {/* Photo + Confidential Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png"
            capture="environment"
            onChange={handlePhotoChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800 hover:bg-slate-100 min-h-[54px]"
          >
            <Camera className="h-5 w-5" />
            <span>{imageDataUrl ? 'Replace Photo' : 'Attach / Take Photo'}</span>
          </button>

          <button
            type="button"
            onClick={() => setConfidential((prev) => !prev)}
            className={`flex items-center justify-center gap-2 rounded-xl border-2 px-4 py-3 text-sm font-bold transition min-h-[54px] ${
              confidential
                ? 'border-amber-500 bg-amber-100 text-amber-950'
                : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
            }`}
          >
            {confidential ? <Lock className="h-5 w-5 text-amber-700" /> : <Unlock className="h-5 w-5" />}
            <span>{confidential ? 'Confidential: ON (On-Device Only)' : 'Confidential Lock: OFF'}</span>
          </button>
        </div>

        {imageDataUrl && (
          <div className="relative inline-block">
            <img
              src={imageDataUrl}
              alt="Defect attachment preview"
              className="h-36 w-auto rounded-lg border border-slate-300 object-cover"
            />
            <button
              type="button"
              onClick={() => setImageDataUrl(undefined)}
              style={{ minHeight: '32px' }}
              className="absolute -top-2 -right-2 rounded-full bg-slate-900 p-1.5 text-white shadow"
              title="Remove photo"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Primary Action Button */}
        <button
          type="button"
          onClick={handleStructure}
          disabled={processing}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-6 py-4 text-base font-bold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60 min-h-[56px]"
        >
          <Sparkles className="h-5 w-5" />
          <span>{processing ? 'Structuring Defect...' : 'Structure with AI'}</span>
        </button>

        {processing && (
          <div className="rounded-xl border border-slate-300 bg-slate-50 p-3.5 space-y-1.5">
            <p className="text-xs font-mono font-semibold text-slate-600">
              Streaming AI output...{' '}
              {streamingTtftMs !== undefined ? `(TTFT: ${streamingTtftMs} ms)` : '(waiting for first token)'}
            </p>
            {streamingPreview && (
              <pre className="max-h-36 overflow-auto text-xs font-mono text-slate-800 whitespace-pre-wrap">
                {streamingPreview}
              </pre>
            )}
          </div>
        )}

        {blockedPayload && (
          <div className="space-y-3 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm font-medium text-rose-900">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-5 w-5 shrink-0 text-rose-600 mt-0.5" />
              <div>{blockedPayload.reason}</div>
            </div>
            <button
              type="button"
              onClick={handleSaveBlockedLocally}
              className="flex items-center justify-center gap-2 rounded-lg border border-rose-400 bg-white px-4 py-2 text-xs font-bold text-rose-900 hover:bg-rose-100"
            >
              <Save className="h-4 w-4" />
              <span>Save locally without AI</span>
            </button>
          </div>
        )}

        {errorMsg && !blockedPayload && (
          <div className="flex items-start gap-2.5 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm font-medium text-rose-900">
            <AlertTriangle className="h-5 w-5 shrink-0 text-rose-600 mt-0.5" />
            <div>{errorMsg}</div>
          </div>
        )}

        {savedBanner && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
              <span>{savedBanner}</span>
            </div>
            <Link to="/records" className="text-xs font-bold text-emerald-800 underline hover:text-emerald-950">
              View in Records →
            </Link>
          </div>
        )}
      </div>

      {/* Human-in-the-loop Editable Result */}
      {draftResult && (
        <div className="space-y-4">
          <EditableStructuredCard
            structured={draftResult.structured}
            onChange={(updated) => setDraftResult({ ...draftResult, structured: updated })}
            inferenceSource={draftResult.source}
            latencyMs={draftResult.latencyMs}
            maskingMap={draftResult.maskingMap}
            maskedNote={draftResult.maskedNote}
            quantityCorrected={draftResult.quantityCorrected}
            originalQuantity={draftResult.originalQuantity}
          />
          <button
            type="button"
            onClick={handleSaveConfirmed}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-6 py-4 text-base font-bold text-white shadow-sm hover:bg-emerald-800 min-h-[56px]"
          >
            <Save className="h-5 w-5" />
            <span>Confirm & Save Record (Masked Cloud Sync)</span>
          </button>
        </div>
      )}
    </div>
  );
}
