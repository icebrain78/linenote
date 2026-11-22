import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Download, CheckSquare, Square, Database } from 'lucide-react';
import { loadAllAvailableRecords } from '../data/sync';
import type { DefectRecord } from '../types';
import { RecordCard } from '../components/RecordCard';

export function Records() {
  const [records, setRecords] = useState<DefectRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterLine, setFilterLine] = useState('ALL');
  const navigate = useNavigate();

  const loadRecords = async () => {
    const all = await loadAllAvailableRecords();
    setRecords(all);
  };

  useEffect(() => {
    loadRecords();
  }, []);

  const lines = ['ALL', ...Array.from(new Set(records.map((r) => r.line)))];
  const filtered = filterLine === 'ALL' ? records : records.filter((r) => r.line === filterLine);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 50) next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.slice(0, 50).map((r) => r.id)));
    }
  };

  const handleAnalyzeSelected = () => {
    const ids = Array.from(selectedIds);
    navigate('/analyze', { state: { selectedIds: ids } });
  };

  const handleExportCsv = () => {
    const header = [
      'id',
      'createdAt',
      'line',
      'defectType',
      'severity',
      'part',
      'location',
      'quantity',
      'confidential',
      'inferenceSource',
      'syncStatus',
      'maskedNote',
    ];
    const rows = filtered.map((r) =>
      [
        r.id,
        r.createdAt,
        r.line,
        r.structured.defectType,
        r.structured.severity,
        r.maskedStructured.part,
        r.maskedStructured.location,
        r.structured.quantity,
        r.confidential,
        r.inferenceSource,
        r.syncStatus,
        `"${(r.maskedNote || '').replace(/"/g, '""')}"`,
      ].join(',')
    );
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `linenote-masked-defects-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Defect Records ({records.length})</h2>
          <p className="text-xs text-slate-600">
            Raw notes stay on-device. Select 2–50 records to run masked Cloud Root-Cause Analysis.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filterLine}
            onChange={(e) => setFilterLine(e.target.value)}
            className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800"
          >
            {lines.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={selectAllFiltered}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            {selectedIds.size === filtered.length && filtered.length > 0 ? (
              <CheckSquare className="h-4 w-4" />
            ) : (
              <Square className="h-4 w-4" />
            )}
            <span>{selectedIds.size === filtered.length && filtered.length > 0 ? 'Unselect All' : 'Select All'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            <span>CSV (Masked)</span>
          </button>

          <button
            type="button"
            onClick={handleAnalyzeSelected}
            disabled={selectedIds.size < 2}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-40"
          >
            <BarChart3 className="h-4 w-4" />
            <span>Analyze Root Causes ({selectedIds.size})</span>
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center space-y-3">
          <Database className="mx-auto h-10 w-10 text-slate-400" />
          <h3 className="text-base font-bold text-slate-800">No defect records yet</h3>
          <p className="text-sm text-slate-600">
            Capture a defect on the Capture tab, or load the virtual sheet-metal plant sample dataset in Device Check.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((rec) => (
            <RecordCard
              key={rec.id}
              record={rec}
              selected={selectedIds.has(rec.id)}
              onToggleSelect={toggleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
