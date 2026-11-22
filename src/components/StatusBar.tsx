import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Wifi,
  WifiOff,
  RefreshCw,
  Cpu,
  Camera,
  ClipboardList,
  BarChart3,
  Activity,
  Laptop,
} from 'lucide-react';
import { localDb } from '../data/db';
import { flushPendingSyncs } from '../data/sync';
import {
  checkChromeLanguageModelAvailability,
  subscribeOnDeviceStatus,
  type OnDeviceStatus,
} from '../ai/models';

export function StatusBar() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [modelStatus, setModelStatus] = useState<OnDeviceStatus>('unknown');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshPendingCount = async () => {
    try {
      const count = await localDb.records.where('syncStatus').equals('pending').count();
      setPendingCount(count);
    } catch {
      // Ignore initial DB open error
    }
  };

  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      setSyncing(true);
      await flushPendingSyncs();
      await refreshPendingCount();
      setSyncing(false);
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const unsub = subscribeOnDeviceStatus((status, progress) => {
      setModelStatus(status);
      setDownloadProgress(progress);
    });

    checkChromeLanguageModelAvailability();
    refreshPendingCount();
    if (navigator.onLine) {
      flushPendingSyncs().then(refreshPendingCount);
    }
    const timer = setInterval(refreshPendingCount, 3000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsub();
      clearInterval(timer);
    };
  }, []);

  const handleManualSync = async () => {
    if (!isOnline || syncing) return;
    setSyncing(true);
    await flushPendingSyncs();
    await refreshPendingCount();
    setSyncing(false);
  };

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap min-h-[48px] ${
      isActive
        ? 'bg-slate-900 text-white shadow-sm'
        : 'text-slate-700 hover:bg-slate-200'
    }`;

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-white font-bold text-lg">
              LN
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900 leading-tight">LineNote</h1>
              <p className="text-xs text-slate-600">Hybrid AI Factory QC Copilot</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
            {/* On-device Model Status */}
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 border ${
                modelStatus === 'available'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : modelStatus === 'downloading'
                  ? 'bg-blue-50 text-blue-800 border-blue-200'
                  : 'bg-slate-100 text-slate-700 border-slate-300'
              }`}
            >
              <Cpu className="h-3.5 w-3.5" />
              <span>
                Nano:{' '}
                {modelStatus === 'downloading'
                  ? `downloading ${downloadProgress}%`
                  : modelStatus}
              </span>
            </span>

            {/* Online / Offline & Pending Sync */}
            <button
              type="button"
              onClick={handleManualSync}
              disabled={!isOnline || syncing}
              style={{ minHeight: '32px' }}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 border transition ${
                isOnline
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                  : 'bg-rose-50 text-rose-800 border-rose-200'
              }`}
              title={isOnline ? 'Click to flush pending syncs' : 'Offline mode: saving locally'}
            >
              {isOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
              <span>{isOnline ? (pendingCount === 0 ? 'Online · Synced' : 'Online') : 'Offline'}</span>
              {pendingCount > 0 && (
                <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-bold text-amber-950">
                  <RefreshCw className={`h-3 w-3 ${syncing ? 'animate-spin' : ''}`} />
                  {pendingCount} queued
                </span>
              )}
            </button>
          </div>
        </div>

        <nav className="mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-1">
          <NavLink to="/" end className={navClass}>
            <Camera className="h-4 w-4" />
            <span>Capture</span>
          </NavLink>
          <NavLink to="/records" className={navClass}>
            <ClipboardList className="h-4 w-4" />
            <span>Records</span>
          </NavLink>
          <NavLink to="/analyze" className={navClass}>
            <BarChart3 className="h-4 w-4" />
            <span>Analyze & 8D</span>
          </NavLink>
          <NavLink to="/hybrid-log" className={navClass}>
            <Activity className="h-4 w-4" />
            <span>Hybrid Log</span>
          </NavLink>
          <NavLink to="/device-check" className={navClass}>
            <Laptop className="h-4 w-4" />
            <span>Device Check</span>
          </NavLink>
        </nav>
      </div>
    </header>
  );
}
