import { useEffect, useRef, useState } from 'react';
import { api, post } from './api';

export type StartupUpdateManifest = {
  version: string;
  available?: boolean;
  assetName?: string;
  size?: number;
  releaseNotes?: string;
  releasePage?: string;
};

export type StartupUpdatePhase = 'available' | 'downloading' | 'verifying' | 'ready' | 'installing' | 'error';

export type StartupUpdateView = {
  phase: StartupUpdatePhase;
  manifest: StartupUpdateManifest;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  error?: string;
};

type UpdatesResponse = {
  lastResult?: StartupUpdateManifest;
  downloaded?: { ready?: boolean; version?: string; bytes?: number };
};

function formatBytes(value = 0) {
  if (value < 1024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1_073_741_824) return `${(value / 1_048_576).toFixed(1)} MB`;
  return `${(value / 1_073_741_824).toFixed(1)} GB`;
}

export function shouldOfferStartupUpdate(update: UpdatesResponse) {
  return Boolean(update.downloaded?.ready || update.lastResult?.available && update.lastResult.version);
}

export function StartupUpdateModal({ view, onDownload, onInstall, onLater, onRetry }: {
  view: StartupUpdateView;
  onDownload: () => void;
  onInstall: () => void;
  onLater: () => void;
  onRetry: () => void;
}) {
  const { phase, manifest } = view;
  const busy = phase === 'downloading' || phase === 'verifying' || phase === 'installing';
  const title = phase === 'available' ? 'Nieuwe versie beschikbaar'
    : phase === 'ready' ? 'Update klaar om te installeren'
      : phase === 'installing' ? 'ThuisHub wordt bijgewerkt'
        : phase === 'error' ? 'Update kon niet worden gedownload'
          : `ThuisHub ${manifest.version} downloaden`;
  const description = phase === 'available'
    ? `ThuisHub ${manifest.version} is beschikbaar. Wil je de update nu downloaden en daarna installeren?`
    : phase === 'verifying' ? 'Download voltooid. Bestandsgrootte en SHA-256 worden gecontroleerd…'
      : phase === 'ready' ? 'De update is volledig gedownload en gecontroleerd. Je kunt hem nu installeren en ThuisHub opnieuw laten starten.'
        : phase === 'installing' ? 'De app en server sluiten af. Je bibliotheken, instellingen en voortgang blijven behouden.'
          : phase === 'error' ? view.error || 'De huidige installatie is niet gewijzigd.'
            : 'Laat ThuisHub open terwijl de nieuwe versie wordt gedownload.';

  return <div className="update-progress-backdrop" role="dialog" aria-modal="true" aria-labelledby="startup-update-title">
    <section className="update-progress-dialog startup-update-dialog">
      <p className="eyebrow">THUISHUB-UPDATE</p>
      <h2 id="startup-update-title">{title}</h2>
      <p>{description}</p>
      {phase === 'available' && <div className="startup-update-summary"><span>Huidige installatie</span><strong>Nieuwe versie {manifest.version}</strong>{manifest.size ? <small>{formatBytes(manifest.size)}</small> : null}</div>}
      {manifest.releaseNotes && phase === 'available' && <details className="startup-update-notes"><summary>Wat is er nieuw?</summary><p>{manifest.releaseNotes}</p></details>}
      {(phase === 'downloading' || phase === 'verifying') && <>
        <div className={`update-progress-track ${view.totalBytes ? '' : 'indeterminate'}`}><i style={view.totalBytes ? { width: `${Math.max(1, view.percent)}%` } : undefined}/></div>
        <div className="update-progress-meta"><strong>{view.totalBytes ? `${Math.round(view.percent)}%` : 'Bezig…'}</strong><span>{formatBytes(view.downloadedBytes)}{view.totalBytes ? ` van ${formatBytes(view.totalBytes)}` : ''}</span></div>
      </>}
      <div className="button-row">
        {phase === 'available' && <button className="primary" onClick={onDownload}>Downloaden</button>}
        {phase === 'ready' && <button className="primary" onClick={onInstall}>Installeren en herstarten</button>}
        {phase === 'error' && <button className="primary" onClick={onRetry}>Opnieuw proberen</button>}
        {!busy && <button className="secondary" onClick={onLater}>{phase === 'error' ? 'Sluiten' : 'Later'}</button>}
      </div>
    </section>
  </div>;
}

export default function StartupUpdateDialog({ enabled }: { enabled: boolean }) {
  const preview = import.meta.env.DEV && new URLSearchParams(location.search).get('previewUpdate') === 'true';
  const checkStarted = useRef(false);
  const [view, setView] = useState<StartupUpdateView | null>(preview ? {
    phase: 'available',
    manifest: { version: '1.2.15', available: true, size: 255_000_000, releaseNotes: 'Voorbeeld van de automatische updatepopup bij het opstarten.' },
    downloadedBytes: 0,
    totalBytes: 255_000_000,
    percent: 0,
  } : null);

  useEffect(() => {
    if (preview || !enabled || checkStarted.current) return;
    checkStarted.current = true;
    let active = true;
    void (async () => {
      try {
        const checked = await post<{ available?: boolean; manifest?: StartupUpdateManifest }>('/updates/check');
        const update = await api<UpdatesResponse>('/updates');
        if (!active || !checked.available && !update.downloaded?.ready) return;
        const manifest = checked.available && checked.manifest
          ? { ...checked.manifest, available: true }
          : update.lastResult || { version: update.downloaded?.version || '' };
        if (!manifest.version || sessionStorage.getItem(`thuishub-update-later-${manifest.version}`) === 'true') return;
        const ready = Boolean(update.downloaded?.ready);
        setView({
          phase: ready ? 'ready' : 'available',
          manifest,
          downloadedBytes: ready ? Number(update.downloaded?.bytes) || 0 : 0,
          totalBytes: ready ? Number(update.downloaded?.bytes) || 0 : Number(manifest.size) || 0,
          percent: ready ? 100 : 0,
        });
      } catch {
        // Een mislukte achtergrondcontrole mag het opstarten nooit blokkeren.
      }
    })();
    return () => { active = false; };
  }, [enabled, preview]);

  useEffect(() => {
    if (!view || !['downloading', 'verifying'].includes(view.phase)) return;
    let active = true;
    const poll = () => api<any>('/updates/download/status').then(progress => {
      if (!active) return;
      setView(current => current ? {
        ...current,
        phase: progress.state === 'ready' ? 'ready' : progress.state === 'verifying' ? 'verifying' : progress.state === 'error' ? 'error' : 'downloading',
        downloadedBytes: Number(progress.downloadedBytes) || 0,
        totalBytes: Number(progress.totalBytes) || current.totalBytes,
        percent: Number(progress.percent) || 0,
        error: progress.error,
      } : null);
    }).catch(() => undefined);
    void poll();
    const timer = window.setInterval(poll, 400);
    return () => { active = false; window.clearInterval(timer); };
  }, [view?.phase]);

  async function download() {
    if (!view) return;
    const manifest = view.manifest;
    setView(current => current ? { ...current, phase: 'downloading', downloadedBytes: 0, totalBytes: Number(manifest.size) || 0, percent: 0, error: undefined } : null);
    try {
      await post('/updates/download', { confirm: true, manifest });
      const progress = await api<any>('/updates/download/status');
      setView(current => current ? { ...current, phase: 'ready', downloadedBytes: Number(progress.downloadedBytes) || 0, totalBytes: Number(progress.totalBytes) || 0, percent: 100 } : null);
    } catch (error: any) {
      setView(current => current ? { ...current, phase: 'error', error: error.message || 'De update kon niet worden gedownload.' } : null);
    }
  }

  async function install() {
    if (!view) return;
    setView(current => current ? { ...current, phase: 'installing', error: undefined } : null);
    try {
      await post('/updates/install', { confirm: true });
    } catch (error: any) {
      setView(current => current ? { ...current, phase: 'error', error: error.message || 'De installatie kon niet worden gestart.' } : null);
    }
  }

  function later() {
    if (view?.manifest.version) sessionStorage.setItem(`thuishub-update-later-${view.manifest.version}`, 'true');
    setView(null);
  }

  if (!view) return null;
  return <StartupUpdateModal view={view} onDownload={() => void download()} onInstall={() => void install()} onLater={later} onRetry={() => void download()}/>;
}
