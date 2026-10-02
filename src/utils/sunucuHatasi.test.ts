import { describe, it, expect } from 'vitest';
import { sunucuHataMetni } from './sunucuHatasi';

describe('sunucuHataMetni', () => {
  it('4xx yanıtın `error` metnini çıkarır', () => {
    const h = new Error('dbClient PUT /settings/luca → 403 {"error":"Bağlantı adresi (baseUrl) yalnız Yönetici tarafından değiştirilebilir."}');
    expect(sunucuHataMetni(h)).toBe('Bağlantı adresi (baseUrl) yalnız Yönetici tarafından değiştirilebilir.');
  });
  it('5xx, JSON olmayan / kesilmiş gövde, `error` alanı olmayan yanıt ve başka hata → null (genel bildirime düşülür)', () => {
    expect(sunucuHataMetni(new Error('dbClient PUT /x → 500 {"error":"Veritabanı işlemi başarısız."}'))).toBeNull();
    expect(sunucuHataMetni(new Error('dbClient PUT /x → 403 <html>IIS</html>'))).toBeNull();
    expect(sunucuHataMetni(new Error('dbClient PUT /x → 403 {"error":"kesilmiş met'))).toBeNull();
    expect(sunucuHataMetni(new Error('dbClient PUT /x → 400 {"hata":"x"}'))).toBeNull();
    expect(sunucuHataMetni(new Error('Failed to fetch'))).toBeNull();
    expect(sunucuHataMetni(undefined)).toBeNull();
  });
});
