import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { Sparkles, Eye, EyeOff, ChevronDown, ChevronUp, FileDown, ShieldCheck, AlertTriangle, Database } from 'lucide-react';
import { localDb, getGlobalMaskingMap, migrateRecordsToGlobalTokenMap } from '../data/db';
import { loadAllAvailableRecords } from '../data/sync';
import { analyzeMaskedRecordsInCloud } from '../ai/models';
import { restoreMaskedText } from '../ai/masking';
import type { DefectRecord, RootCauseAnalysis } from '../types';
import { SourceBadge } from '../components/SourceBadge';
import sampleRecords from '../../sample-data/records.json';

export function Analyze() {
  const location = useLocation();
  const initialIds: string[] = (location.state as { selectedIds?: string[] } | null)?.selectedIds || [];

  const [records, setRecords] = useState<DefectRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>(initialIds);
  const [analysis, setAnalysis] = useState<RootCauseAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showPayload, setShowPayload] = useState(false);
  const [restoreLocal, setRestoreLocal] = useState(false);
  const [globalMap, setGlobalMap] = useState<Record<string, string>>({});

  const [demoNotice, setDemoNotice] = useState<string | null>(null);

  const loadRecords = async (preferSelectAll = false) => {
    const all = await loadAllAvailableRecords();
    const gMap = await getGlobalMaskingMap();
    setGlobalMap(gMap);
    setRecords(all);
    if ((preferSelectAll || initialIds.length === 0) && all.length >= 2) {
      setSelectedIds(all.slice(0, Math.min(50, all.length)).map((r) => r.id));
    }
  };

  useEffect(() => {
    const init = async () => {
      await loadRecords();
      const lastAnalysis = await localDb.analyses.orderBy('createdAt').reverse().first();
      if (lastAnalysis) setAnalysis(lastAnalysis);
    };
    init();
  }, []);

  const handleLoadDemoDataset = async () => {
    const items = sampleRecords as unknown as DefectRecord[];
    let added = 0;
    for (const item of items) {
      const existing = await localDb.records.get(item.id);
      if (!existing) {
        await localDb.records.add(item);
        added++;
      }
    }
    await migrateRecordsToGlobalTokenMap();
    await loadRecords(true);
    setErrorMsg(null);
    setDemoNotice(
      added > 0
        ? `Sample Data: Loaded ${added} virtual sheet-metal plant records (12 sample records total).`
        : 'Sample Data: All 12 sample records are loaded and selected.'
    );
  };

  const selectedRecords = records.filter((r) => selectedIds.includes(r.id));

  // Use global IndexedDB token map merged with selected records' local maps
  const combinedMaskingMap: Record<string, string> = { ...globalMap };
  for (const r of selectedRecords) {
    Object.assign(combinedMaskingMap, r.maskingMap);
  }

  const renderRestoredNodes = (text: string) => {
    if (!restoreLocal || !text) return text;
    const tokens = Object.keys(combinedMaskingMap);
    if (tokens.length === 0) return text;
    const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`(${escaped.join('|')})`, 'g');
    const parts = text.split(regex);
    return parts.map((part, idx) => {
      const original = combinedMaskingMap[part];
      if (original) {
        return (
          <span
            key={idx}
            title={`Restored locally from ${part}`}
            className="underline decoration-dotted decoration-amber-600 underline-offset-4 bg-amber-100/70 px-1 rounded font-semibold text-amber-950"
          >
            {original}
          </span>
        );
      }
      return part;
    });
  };

  const handleRunAnalysis = async () => {
    if (selectedRecords.length < 2) {
      setErrorMsg('Please select at least 2 records (from Records tab) to analyze.');
      return;
    }
    setLoading(true);
    setErrorMsg(null);

    const maskedPayload = selectedRecords.map((r) => ({
      id: r.id,
      line: r.line,
      maskedNote: r.maskedNote,
      defectType: r.maskedStructured.defectType,
      part: r.maskedStructured.part,
      location: r.maskedStructured.location,
      quantity: r.maskedStructured.quantity,
      severity: r.maskedStructured.severity,
      suspectedCause: r.maskedStructured.suspectedCause,
      immediateAction: r.maskedStructured.immediateAction,
      createdAt: r.createdAt,
    }));

    try {
      const res = await analyzeMaskedRecordsInCloud(maskedPayload);
      const saved: RootCauseAnalysis = {
        id: `ana_${Date.now()}`,
        recordIds: selectedRecords.map((r) => r.id),
        createdAt: new Date().toISOString(),
        ...res,
      };
      await localDb.analyses.add(saved);
      setAnalysis(saved);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleExportMarkdown = (withLocalValues = false) => {
    if (!analysis) return;
    const fmt = (txt: string) => (withLocalValues ? restoreMaskedText(txt, combinedMaskingMap) : txt);
    const md = [
      `# LineNote 8D Quality Report`,
      `Generated: ${analysis.createdAt} | Source: ${analysis.inferenceSource} (${analysis.latencyMs} ms)`,
      `Privacy Mode: ${withLocalValues ? 'Local Values Restored (On-device only)' : 'Masked Tokens Only (Cloud-safe)'}`,
      '',
      `## Pareto Summary`,
      ...analysis.pareto.map((p) => `- **${p.defectType}**: ${p.count}`),
      '',
      `## Root Cause Hypotheses`,
      ...analysis.hypotheses.map(
        (h, i) =>
          `${i + 1}. **${fmt(h.cause)}** (Confidence: ${Math.round(h.confidence * 100)}%, Evidence: ${h.evidenceRecordIds.join(', ')})`
      ),
      '',
      `## 8D Draft`,
      ...Object.entries(analysis.eightD).map(([k, v]) => `### ${k}\n${fmt(v)}`),
      '',
      `## Recommended Next Checks`,
      ...analysis.nextChecks.map((c) => `- ${fmt(c)}`),
    ].join('\n');

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `linenote-8d-${withLocalValues ? 'local-' : 'masked-'}${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Cloud Root-Cause & 8D Analysis</h2>
            <p className="text-xs text-slate-600">
              Uses <code className="font-mono bg-slate-100 px-1 rounded">ONLY_IN_CLOUD</code> on{' '}
              <strong>{selectedRecords.length}</strong> de-identified (masked) records.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleLoadDemoDataset}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100"
            >
              <Database className="h-4 w-4" />
              <span>Load demo dataset (12 sample records)</span>
            </button>

            <button
              type="button"
              onClick={() => setRestoreLocal((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            >
              {restoreLocal ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              <span>{restoreLocal ? 'Local Tokens Restored' : 'Showing Masked Tokens'}</span>
            </button>

            <button
              type="button"
              onClick={handleRunAnalysis}
              disabled={loading || selectedRecords.length < 2}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              <span>{loading ? 'Analyzing in Cloud...' : `Analyze ${selectedRecords.length} Records`}</span>
            </button>
          </div>
        </div>

        {demoNotice && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
            {demoNotice}
          </div>
        )}

        <div className="text-xs text-slate-600">
          Available saved records: <strong>{records.length}</strong> (selected: <strong>{selectedRecords.length}</strong>)
        </div>

        {errorMsg && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 p-3.5 text-sm text-rose-900">
            <AlertTriangle className="h-5 w-5 shrink-0 text-rose-600" />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>

      {analysis && (
        <div className="space-y-6">
          {/* Privacy Verification Banner */}
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold text-emerald-950">
                <ShieldCheck className="h-5 w-5 text-emerald-700" />
                <span>Sent to cloud: masked fields only (raw notes & photos never left device)</span>
              </div>
              <div className="flex items-center gap-2">
                <SourceBadge source={analysis.inferenceSource} latencyMs={analysis.latencyMs} />
                <button
                  type="button"
                  onClick={() => handleExportMarkdown(false)}
                  style={{ minHeight: '36px' }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400 bg-white px-3 py-1 text-xs font-semibold text-emerald-900 hover:bg-emerald-100"
                >
                  <FileDown className="h-3.5 w-3.5" />
                  <span>Export 8D (.md)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExportMarkdown(true)}
                  style={{ minHeight: '36px' }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-950 hover:bg-amber-100"
                >
                  <FileDown className="h-3.5 w-3.5" />
                  <span>Export with local values</span>
                </button>
              </div>
            </div>

            {restoreLocal && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-950">
                Restored locally on this device - cloud saw only tokens
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowPayload((p) => !p)}
              style={{ minHeight: '32px' }}
              className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 underline"
            >
              {showPayload ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              <span>{showPayload ? 'Hide' : 'Inspect'} exact JSON payload sent to Cloud Gemini</span>
            </button>

            {showPayload && (
              <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-emerald-300 font-mono">
                {analysis.sentPayloadJson}
              </pre>
            )}
          </div>

          {/* Pareto Chart */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-base font-bold text-slate-900 mb-3">Defect Pareto Breakdown</h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analysis.pareto}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="defectType" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#0f172a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Top 3 Hypotheses */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
            <h3 className="text-base font-bold text-slate-900">Root Cause Hypotheses</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {analysis.hypotheses.map((h, idx) => (
                <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-600">
                    <span>Hypothesis #{idx + 1}</span>
                    <span className="rounded bg-slate-200 px-2 py-0.5 text-slate-900">
                      {Math.round(h.confidence * 100)}% conf.
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-slate-900">{renderRestoredNodes(h.cause)}</p>
                  <p className="text-xs font-mono text-slate-500">
                    Evidence: {h.evidenceRecordIds.join(', ')}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* 8D Report Draft */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
            <h3 className="text-base font-bold text-slate-900">8D Report Draft (D1 – D8)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(analysis.eightD).map(([discipline, content]) => (
                <div key={discipline} className="rounded-lg border border-slate-200 p-3 bg-slate-50">
                  <span className="inline-block rounded bg-slate-900 px-2 py-0.5 text-xs font-bold text-white mb-1">
                    {discipline}
                  </span>
                  <p className="text-sm text-slate-800">{renderRestoredNodes(content)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Next Checks */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
            <h3 className="text-base font-bold text-slate-900">Recommended Floor Checks</h3>
            <ul className="list-disc pl-5 text-sm text-slate-800 space-y-1">
              {analysis.nextChecks.map((check, i) => (
                <li key={i}>{renderRestoredNodes(check)}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
