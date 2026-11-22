import { useEffect, useState } from 'react';
import { RefreshCw, Play, Database, CheckCircle2, AlertCircle, Terminal } from 'lucide-react';
import { auth, isFirebaseConfigured, ensureAnonymousAuth, getRemotePolicy, refreshRemotePolicy } from '../firebase';
import { checkChromeLanguageModelAvailability, runDeviceHelloTest } from '../ai/models';
import { SourceBadge } from '../components/SourceBadge';
import { localDb, migrateRecordsToGlobalTokenMap } from '../data/db';
import type { DefectRecord, InferenceSourceType } from '../types';
import sampleRecords from '../../sample-data/records.json';

function parseChromeMajor(): number | null {
  const m = navigator.userAgent.match(/Chrome\/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

export function DeviceCheck() {
  const [availability, setAvailability] = useState<string>('Checking...');
  const [uid, setUid] = useState<string | null>(auth?.currentUser?.uid || null);
  const [helloLoading, setHelloLoading] = useState(false);
  const [streamingText, setStreamingText] = useState<string>('');
  const [streamingTtftMs, setStreamingTtftMs] = useState<number | undefined>();
  const [helloResult, setHelloResult] = useState<{
    text: string;
    source: InferenceSourceType;
    ttftMs: number;
    latencyMs: number;
  } | null>(null);
  const [helloError, setHelloError] = useState<string | null>(null);
  const [sampleLoadedMsg, setSampleLoadedMsg] = useState<string | null>(null);
  const [policy, setPolicy] = useState(getRemotePolicy());

  const chromeMajor = parseChromeMajor();

  const runCheck = async () => {
    const res = await checkChromeLanguageModelAvailability();
    setAvailability(res);
    if (isFirebaseConfigured) {
      const user = await ensureAnonymousAuth();
      setUid(user?.uid || null);
      const latest = await refreshRemotePolicy();
      setPolicy(latest);
    }
  };

  useEffect(() => {
    runCheck();
    const unsub = auth?.onAuthStateChanged((user) => {
      setUid(user?.uid || null);
    });
    return () => unsub?.();
  }, []);

  const handleHelloTest = async () => {
    setHelloLoading(true);
    setHelloError(null);
    setHelloResult(null);
    setStreamingText('');
    setStreamingTtftMs(undefined);
    try {
      const res = await runDeviceHelloTest((partial, ttft) => {
        setStreamingText(partial);
        if (ttft !== undefined) setStreamingTtftMs(ttft);
      });
      setHelloResult(res);
    } catch (err) {
      setHelloError(err instanceof Error ? err.message : String(err));
    } finally {
      setHelloLoading(false);
    }
  };

  const handleLoadSamples = async () => {
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
    setSampleLoadedMsg(
      added > 0
        ? `Loaded ${added} virtual sheet-metal plant defect records into IndexedDB.`
        : 'All sample records are already loaded in IndexedDB.'
    );
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Device & Hybrid AI Readiness Check</h2>
            <p className="text-xs text-slate-600">
              Verifies Chrome Built-in Gemini Nano availability and Firebase AI Logic connectivity.
            </p>
          </div>
          <button
            type="button"
            onClick={runCheck}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Re-check</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
            <p className="text-xs font-bold uppercase text-slate-500">Chrome Version</p>
            <p className="mt-1 text-base font-bold text-slate-900">
              {chromeMajor ? `Chrome ${chromeMajor}` : 'Non-Chrome / Unknown'}
            </p>
            <p className="mt-0.5 text-xs text-slate-600">
              {chromeMajor && chromeMajor >= 139 ? 'Meets 139+ requirement' : 'Chrome Desktop 139+ recommended for Nano'}
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
            <p className="text-xs font-bold uppercase text-slate-500">LanguageModel.availability()</p>
            <p className="mt-1 text-base font-mono font-bold text-slate-900">{availability}</p>
            <p className="mt-0.5 text-xs text-slate-600">
              {availability === 'available' || availability === 'readily'
                ? 'On-device Gemini Nano ready'
                : 'Cloud fallback active for non-sensitive notes'}
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
            <p className="text-xs font-bold uppercase text-slate-500">Firebase & Auth</p>
            <div className="mt-1 flex items-center gap-1.5 text-sm font-bold text-slate-900">
              {isFirebaseConfigured ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>Configured</span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <span>Missing .env.local</span>
                </>
              )}
            </div>
            <p className="mt-0.5 text-xs font-mono text-slate-600 truncate">
              {uid ? `Anon UID: ${uid}` : 'Not signed in yet'}
            </p>
          </div>
        </div>

        {/* Remote Config Policy */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-700 flex flex-wrap items-center justify-between gap-2">
          <span>
            <strong>Remote Config Policy:</strong> mode=<code className="font-mono">{policy.structurerMode}</code> ·
            cloudModel=<code className="font-mono">{policy.cloudModel}</code> ·
            patterns=<strong>{policy.sensitivePatterns.length}</strong> ·
            customers=<strong>{policy.customerNames.length}</strong>
          </span>
          <span className="font-mono text-slate-500 truncate max-w-xs">
            [{policy.customerNames.join(', ')}]
          </span>
        </div>

        {/* Hello Test */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Quick Hybrid AI Hello Test</h3>
              <p className="text-xs text-slate-600">
                Calls <code className="font-mono">firebase/ai</code> with{' '}
                <code className="font-mono">PREFER_ON_DEVICE</code> and verifies{' '}
                <code className="font-mono">inferenceSource</code>.
              </p>
            </div>
            <button
              type="button"
              onClick={handleHelloTest}
              disabled={helloLoading || !isFirebaseConfigured}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              <span>{helloLoading ? 'Running...' : 'Run Hello Test'}</span>
            </button>
          </div>

          {helloLoading && (
            <div className="rounded-lg border border-slate-300 bg-white p-3 space-y-1">
              <p className="text-xs font-mono text-slate-500">
                Streaming... {streamingTtftMs !== undefined ? `(TTFT: ${streamingTtftMs} ms)` : '(waiting for first token)'}
              </p>
              {streamingText && <p className="text-sm font-medium text-slate-900">{streamingText}</p>}
            </div>
          )}

          {helloResult && (
            <div className="rounded-lg border border-emerald-300 bg-white p-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-slate-900">{helloResult.text}</p>
                <p className="text-xs font-mono text-slate-500 mt-0.5">
                  TTFT: {helloResult.ttftMs} ms · Total: {helloResult.latencyMs} ms
                </p>
              </div>
              <SourceBadge source={helloResult.source} latencyMs={helloResult.latencyMs} />
            </div>
          )}

          {helloError && (
            <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs font-medium text-rose-900">
              {helloError}
            </div>
          )}
        </div>
      </div>

      {/* Chrome Flag Instructions */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
        <div className="flex items-center gap-2">
          <Terminal className="h-5 w-5 text-slate-700" />
          <h3 className="text-base font-bold text-slate-900">How to Enable On-Device Gemini Nano (Chrome Desktop 139+)</h3>
        </div>
        <ol className="list-decimal pl-5 text-sm text-slate-700 space-y-1.5">
          <li>
            Open{' '}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-900">
              chrome://flags/#prompt-api-for-gemini-nano-multimodal-input
            </code>{' '}
            in Chrome Desktop.
          </li>
          <li>
            Set the flag to <strong>Enabled</strong> and click <strong>Relaunch</strong>.
          </li>
          <li>
            In DevTools Console, run{' '}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-900">
              await LanguageModel.availability()
            </code>{' '}
            or click <strong>Run Hello Test</strong> above to trigger the initial model download.
          </li>
          <li>
            On browsers without Nano (mobile/other browsers), standard notes automatically fall back to Cloud Gemini,
            while confidential notes are strictly blocked from leaving the device.
          </li>
        </ol>
      </div>

      {/* Sample Dataset Loader */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900">Virtual Plant Sample Dataset</h3>
          <p className="text-xs text-slate-600">
            Load pre-masked & confidential sample records from a fictional sheet-metal enclosure plant for testing 8D analysis.
          </p>
          {sampleLoadedMsg && <p className="mt-1 text-xs font-semibold text-emerald-700">{sampleLoadedMsg}</p>}
        </div>
        <button
          type="button"
          onClick={handleLoadSamples}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-100"
        >
          <Database className="h-4 w-4" />
          <span>Load Sample Records</span>
        </button>
      </div>
    </div>
  );
}
