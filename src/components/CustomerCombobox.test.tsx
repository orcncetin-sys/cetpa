// @vitest-environment jsdom
/**
 * CustomerCombobox.test.tsx — cari seçicinin araması Türkçe-duyarlı ve ASCII-bağışlayıcı (utils/arama `eslesir`).
 *
 * NEDEN: müşteri / bayi hesabı açmanın («Kullanıcı Ekle», dış rolde cari zorunlu) ve «Cari bağla»nın TEK yolu bu bileşen; serbest
 * yazım seçimi düşürdüğü için listede bulunmayan cari seçilemez, düğme pasif kalır. Mikro unvanları büyük harfle gelir («ÖZ YAPI
 * İNŞAAT»); dil ayarsız `toLowerCase` onu «yapı» / «inşaat» aramasında bulmuyordu (I → i, İ → i + birleşik nokta U+0307).
 */
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CustomerCombobox from './CustomerCombobox';
import type { Lead } from '../types';

afterEach(cleanup);

const lead = (id: string, name: string, company = ''): Lead => ({
  id, name, company, email: '', phone: '', status: 'New', assignedTo: '', customerType: 'B2B',
});

const LEADS: Lead[] = [
  lead('l-oz', 'ÖZ YAPI İNŞAAT'),
  lead('l-isik', 'Ahmet Işık', 'IŞIK HIRDAVAT'),
  lead('l-diger', 'Deniz Boya Ltd.'),
];

/** Bileşeni gerçek kullanımı gibi denetimli çizer; görünen seçenek adlarını döner. */
function Sarmal({ onSelect }: { onSelect: (l: Lead) => void }) {
  const [deger, setDeger] = useState('');
  return <CustomerCombobox leads={LEADS} value={deger} onChange={setDeger} onSelect={onSelect} placeholder="Cari ara" />;
}

function ara(sorgu: string): string[] {
  cleanup();
  render(<Sarmal onSelect={() => {}} />);
  const kutu = screen.getByPlaceholderText('Cari ara');
  fireEvent.focus(kutu);
  fireEvent.change(kutu, { target: { value: sorgu } });
  return screen.queryAllByRole('button').map(b => b.querySelector('p')?.textContent ?? '');
}

describe('CustomerCombobox — Türkçe-duyarlı arama', () => {
  it.each(['yapı', 'inşaat', 'YAPI', 'yapi', 'İNŞAAT', 'insaat', 'öz yapı'])('«ÖZ YAPI İNŞAAT» → «%s» ile bulunur', sorgu => {
    expect(ara(sorgu)).toEqual(['ÖZ YAPI İNŞAAT']);
  });

  it.each(['ışık', 'ISIK', 'Işık', 'isik', 'hırdavat'])('«Ahmet Işık» (firma «IŞIK HIRDAVAT») → «%s» ile bulunur', sorgu => {
    expect(ara(sorgu)).toEqual(['Ahmet Işık']);
  });

  it('boş ve yalnız boşluk sorgu süzmez: bütün cariler listelenir', () => {
    expect(ara('')).toEqual(['ÖZ YAPI İNŞAAT', 'Ahmet Işık', 'Deniz Boya Ltd.']);
    expect(ara('   ')).toEqual(['ÖZ YAPI İNŞAAT', 'Ahmet Işık', 'Deniz Boya Ltd.']);
  });

  it('eşleşmeyen sorgu boş liste; bulunan cari tıklanınca seçilir', () => {
    expect(ara('çimento')).toEqual([]);
    cleanup();
    const onSelect = vi.fn();
    render(<Sarmal onSelect={onSelect} />);
    const kutu = screen.getByPlaceholderText('Cari ara');
    fireEvent.focus(kutu);
    fireEvent.change(kutu, { target: { value: 'yapı' } });
    fireEvent.mouseDown(screen.getByRole('button', { name: /ÖZ YAPI İNŞAAT/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe('l-oz');
  });
});
