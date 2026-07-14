import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { shouldOfferStartupUpdate, StartupUpdateModal, type StartupUpdateView } from './StartupUpdateDialog';

const handlers = { onDownload: () => undefined, onInstall: () => undefined, onLater: () => undefined, onRetry: () => undefined };
const available: StartupUpdateView = {
  phase: 'available',
  manifest: { version: '1.2.15', available: true, size: 250_000_000, releaseNotes: 'Betere updatecontrole.' },
  downloadedBytes: 0,
  totalBytes: 250_000_000,
  percent: 0,
};

describe('updatepopup bij opstarten', () => {
  it('verschijnt uitsluitend voor een beschikbare of reeds gedownloade update', () => {
    expect(shouldOfferStartupUpdate({ lastResult: { version: '1.2.15', available: true } })).toBe(true);
    expect(shouldOfferStartupUpdate({ downloaded: { ready: true, version: '1.2.15' } })).toBe(true);
    expect(shouldOfferStartupUpdate({ lastResult: { version: '1.2.14', available: false } })).toBe(false);
  });

  it('vraagt bij een nieuwe versie om downloaden of uitstellen', () => {
    const html = renderToStaticMarkup(<StartupUpdateModal view={available} {...handlers}/>);
    expect(html).toContain('Nieuwe versie beschikbaar');
    expect(html).toContain('ThuisHub 1.2.15');
    expect(html).toContain('Downloaden');
    expect(html).toContain('Later');
    expect(html).not.toContain('Installeren en herstarten');
  });

  it('biedt installeren pas na een gecontroleerde download aan', () => {
    const html = renderToStaticMarkup(<StartupUpdateModal view={{ ...available, phase: 'ready', downloadedBytes: available.totalBytes, percent: 100 }} {...handlers}/>);
    expect(html).toContain('Update klaar om te installeren');
    expect(html).toContain('Installeren en herstarten');
    expect(html).not.toContain('>Downloaden<');
  });
});
