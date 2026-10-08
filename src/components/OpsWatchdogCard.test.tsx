/**
 * OpsWatchdogCard.test.tsx — bekçi kartının etiket tablosu.
 *
 * Bekçiye eklenen kontrol kartta çıplak anahtarla (`magaza_talep`) değil
 * etiketiyle çizilir; etiketi olmayan anahtar olduğu gibi yazılır (kart yeni
 * kontrolü gizlemez).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import OpsWatchdogCard from './OpsWatchdogCard';
import { authedFetch } from '../lib/dbClient';

vi.mock('../lib/dbClient', () => ({ authedFetch: vi.fn() }));

const SONUC = {
  date: '2026-10-08', ok: false,
  checks: [
    { key: 'magaza_talep', ok: false, detail: 'SMTP yapılandırılmamış — eksik: SMTP_USER' },
    { key: 'etiketsiz_kontrol', ok: true, detail: 'tamam' },
  ],
};

beforeEach(() => {
  vi.mocked(authedFetch).mockReset().mockImplementation(async (yol: string) =>
    yol === '/api/ops/watchdog'
      ? new Response(JSON.stringify({ results: [SONUC] }), { status: 200 })
      : new Response('{}', { status: 404 }));
});

describe('OpsWatchdogCard — kontrol etiketleri', () => {
  it('magaza_talep Türkçe arayüzde «Mağaza talep bildirimi» diye çizilir; ayrıntı yanında', async () => {
    render(<OpsWatchdogCard currentLanguage="tr" toast={() => {}} />);
    expect(await screen.findByText('Mağaza talep bildirimi')).toBeInTheDocument();
    expect(screen.getByText('SMTP yapılandırılmamış — eksik: SMTP_USER')).toBeInTheDocument();
    expect(screen.queryByText('magaza_talep')).not.toBeInTheDocument();
    expect(screen.getByText('etiketsiz_kontrol')).toBeInTheDocument();
  });

  it('İngilizce arayüzde «Store request notification»', async () => {
    render(<OpsWatchdogCard currentLanguage="en" toast={() => {}} />);
    expect(await screen.findByText('Store request notification')).toBeInTheDocument();
    expect(screen.queryByText('Mağaza talep bildirimi')).not.toBeInTheDocument();
  });
});
