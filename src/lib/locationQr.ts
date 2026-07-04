// Depo/araç QR kodlarının ortak biçimi. QR etiketine bu string yazılır (Faz 1),
// transfer ekranında okunup parse edilir (Faz 3).
//
// Biçim:  CETPA-LOC:<warehouse|vehicle>:<id>
// Örnek:  CETPA-LOC:warehouse:abc123   /   CETPA-LOC:vehicle:def456
//
// Prefix'in amacı: rastgele bir ürün barkodunun yanlışlıkla lokasyon sanılmasını
// engellemek (transfer akışı "önce lokasyon, sonra ürün" bekliyor).

export type LocationType = 'warehouse' | 'vehicle';

export interface ParsedLocation {
  type: LocationType;
  id: string;
}

const PREFIX = 'CETPA-LOC:';

export function locationQrValue(type: LocationType, id: string): string {
  return `${PREFIX}${type}:${id}`;
}

/** QR/elle girilen bir değeri lokasyona çözer; lokasyon değilse null döner. */
export function parseLocationQr(raw: string): ParsedLocation | null {
  const value = (raw || '').trim();
  if (!value.startsWith(PREFIX)) return null;
  const rest = value.slice(PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep < 0) return null;
  const type = rest.slice(0, sep);
  const id = rest.slice(sep + 1);
  if ((type !== 'warehouse' && type !== 'vehicle') || !id) return null;
  return { type, id };
}

export function isLocationQr(raw: string): boolean {
  return parseLocationQr(raw) !== null;
}
