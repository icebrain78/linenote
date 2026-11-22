import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ensureAnonymousAuth, isFirebaseConfigured, refreshRemotePolicy } from './firebase';
import { migrateRecordsToGlobalTokenMap } from './data/db';
import { StatusBar } from './components/StatusBar';
import { Capture } from './pages/Capture';
import { Records } from './pages/Records';
import { Analyze } from './pages/Analyze';
import { HybridLog } from './pages/HybridLog';
import { DeviceCheck } from './pages/DeviceCheck';

export default function App() {
  useEffect(() => {
    migrateRecordsToGlobalTokenMap();
    if (isFirebaseConfigured) {
      ensureAnonymousAuth();
      refreshRemotePolicy();
    }
  }, []);

  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
        <StatusBar />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
          <Routes>
            <Route path="/" element={<Capture />} />
            <Route path="/records" element={<Records />} />
            <Route path="/analyze" element={<Analyze />} />
            <Route path="/hybrid-log" element={<HybridLog />} />
            <Route path="/device-check" element={<DeviceCheck />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
