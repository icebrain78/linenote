import { useEffect, useState } from 'react';
import { Trash2, ShieldCheck, Cpu, Cloud, Ban } from 'lucide-react';
import { localDb } from '../data/db';
import type { HybridLogEntry } from '../types';
import { SourceBadge } from '../components/SourceBadge';

export function HybridLog() {
  const [logs, setLogs] = useState<HybridLogEntry[]>([]);

  const loadLogs = async () => {
    const all = await localDb.hybridLogs.orderBy('id').reverse().toArray();
    setLogs(all);
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const total = logs.length;
  const onDeviceCount = logs.filter((l) => l.actualSource === 'on_device').length;
  const cloudCount = logs.filter((l) => l.actualSource === 'in_cloud').length;
  const blockedCount = logs.filter((l) => l.blocked).length;
  const onDevicePct = total > 0 ? Math.round((onDeviceCount / total) * 100) : 0;

  const handleClear = async () => {
    await localDb.hybridLogs.clear();
    setLogs([]);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Hybrid AI Governance Log</h2>
          <p className="text-xs text-slate-600">
            Real-time audit trail of <code className="font-mono bg-slate-100 px-1">response.inferenceSource</code>,
            latency, and fail-closed blocks.
          </p>
        </div>
        <button
          type="button"
          onClick={handleClear}
          disabled={logs.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
          <span>Clear Logs</span>
        </button>
      </div>

      {/* Session Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase">
            <ShieldCheck className="h-4 w-4 text-slate-700" />
            <span>Total Requests</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">{total}</p>
        </div>

        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-800 uppercase">
            <Cpu className="h-4 w-4 text-emerald-700" />
            <span>On-Device Ratio</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-emerald-950">
            {onDevicePct}% <span className="text-sm font-medium">({onDeviceCount})</span>
          </p>
        </div>

        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-bold text-sky-800 uppercase">
            <Cloud className="h-4 w-4 text-sky-700" />
            <span>Cloud Calls</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-sky-950">{cloudCount}</p>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-900 uppercase">
            <Ban className="h-4 w-4 text-amber-700" />
            <span>Cloud Blocked</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-amber-950">{blockedCount}</p>
        </div>
      </div>

      {/* Log Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 text-slate-700 uppercase font-bold border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Task</th>
                <th className="px-4 py-3">Requested Mode</th>
                <th className="px-4 py-3">Actual Source</th>
                <th className="px-4 py-3">TTFT / Total</th>
                <th className="px-4 py-3">Cloud Bytes</th>
                <th className="px-4 py-3">Status / Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No AI inference logs recorded yet. Try capturing a defect or running the Device Check hello test.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className={log.blocked ? 'bg-rose-50/70' : 'hover:bg-slate-50'}>
                    <td className="px-4 py-3 font-mono text-slate-600 whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900">{log.task}</td>
                    <td className="px-4 py-3 font-mono text-slate-700">{log.requestedMode}</td>
                    <td className="px-4 py-3">
                      <SourceBadge source={log.actualSource} />
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-800 whitespace-nowrap">
                      {log.ttftMs !== undefined ? `${log.ttftMs} ms / ` : ''}
                      {log.latencyMs} ms
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-800">{log.cloudBytes} B</td>
                    <td className="px-4 py-3">
                      {log.blocked ? (
                        <span className="font-semibold text-rose-700">
                          BLOCKED: {log.reason || 'Policy violation'}
                        </span>
                      ) : (
                        <span className="text-emerald-700 font-medium">Allowed</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
