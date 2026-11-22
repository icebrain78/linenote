import { Cpu, Cloud, ShieldAlert } from 'lucide-react';
import type { InferenceSourceType } from '../types';

interface SourceBadgeProps {
  source: InferenceSourceType;
  latencyMs?: number;
  modelName?: string;
}

export function SourceBadge({ source, latencyMs, modelName }: SourceBadgeProps) {
  const formattedLatency =
    latencyMs !== undefined
      ? latencyMs >= 1000
        ? `${(latencyMs / 1000).toFixed(1)} s`
        : `${Math.round(latencyMs)} ms`
      : null;

  if (source === 'on_device') {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-900 border border-emerald-300"
        title="Processed locally on-device via Gemini Nano"
      >
        <Cpu className="h-3.5 w-3.5 text-emerald-700" />
        <span>On-device</span>
        {formattedLatency && <span className="text-emerald-700">· {formattedLatency}</span>}
      </span>
    );
  }

  if (source === 'in_cloud') {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-900 border border-sky-300"
        title="Processed in Cloud via Firebase AI Logic"
      >
        <Cloud className="h-3.5 w-3.5 text-sky-700" />
        <span>Cloud{modelName ? ` · ${modelName}` : ''}</span>
        {formattedLatency && <span className="text-sky-700">· {formattedLatency}</span>}
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900 border border-amber-300"
      title="Saved locally without AI"
    >
      <ShieldAlert className="h-3.5 w-3.5 text-amber-700" />
      <span>Local Only (No AI)</span>
    </span>
  );
}
