export const MIKRO_DEFAULT_ENDPOINT = 'https://jumpbulutapigw.mikro.com.tr/ApiJB/ApiMethods';

export interface MikroConfig {
  endpoint: string;
  accessToken: string;
  enabled: boolean;
}

interface MikroRequestBody {
  MethodName: string;
  Parameters?: Record<string, unknown>;
}

async function mikroRequest(body: MikroRequestBody, config: MikroConfig): Promise<unknown> {
  const res = await fetch(config.endpoint || MIKRO_DEFAULT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.accessToken}`,
      'access_token': config.accessToken,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Mikro API hatası: ${res.status} ${res.statusText}`);
  return res.json();
}

/** Bağlantı testi — firma listesini çeker */
export async function testMikroConnection(config: MikroConfig): Promise<boolean> {
  try {
    await mikroRequest({ MethodName: 'GetFirmaList' }, config);
    return true;
  } catch {
    return false;
  }
}

// ─── Cetpa → Mikro (PUSH) ────────────────────────────────────────────────────

/** Fatura gönder (Cetpa → Mikro) */
export async function pushInvoiceToMikro(
  invoice: Record<string, unknown>,
  config: MikroConfig
): Promise<unknown> {
  return mikroRequest({ MethodName: 'FaturaKaydet', Parameters: invoice }, config);
}

/** Cari (müşteri/bayi) gönder (Cetpa → Mikro) */
export async function pushCustomerToMikro(
  customer: Record<string, unknown>,
  config: MikroConfig
): Promise<unknown> {
  return mikroRequest({ MethodName: 'CariKaydet', Parameters: customer }, config);
}

/** Yevmiye gönder (Cetpa → Mikro) */
export async function pushJournalToMikro(
  entries: Record<string, unknown>[],
  config: MikroConfig
): Promise<unknown> {
  return mikroRequest({ MethodName: 'YevmiyeKaydet', Parameters: { entries } }, config);
}

/** Stok güncelle (Cetpa → Mikro) */
export async function pushStockToMikro(
  items: Record<string, unknown>[],
  config: MikroConfig
): Promise<unknown> {
  return mikroRequest({ MethodName: 'StokGuncelle', Parameters: { items } }, config);
}

// ─── Mikro → Cetpa (PULL) ────────────────────────────────────────────────────

/** Faturaları çek (Mikro → Cetpa) */
export async function pullInvoicesFromMikro(
  params: Record<string, unknown>,
  config: MikroConfig
): Promise<unknown> {
  return mikroRequest({ MethodName: 'FaturaListesi', Parameters: params }, config);
}

/** Carileri çek (Mikro → Cetpa) */
export async function pullCustomersFromMikro(
  params: Record<string, unknown>,
  config: MikroConfig
): Promise<unknown> {
  return mikroRequest({ MethodName: 'CariListesi', Parameters: params }, config);
}

/** Stok listesini çek (Mikro → Cetpa) */
export async function pullStockFromMikro(
  params: Record<string, unknown>,
  config: MikroConfig
): Promise<unknown> {
  return mikroRequest({ MethodName: 'StokListesi', Parameters: params }, config);
}

/** Yevmiye kayıtlarını çek (Mikro → Cetpa) */
export async function pullJournalFromMikro(
  params: Record<string, unknown>,
  config: MikroConfig
): Promise<unknown> {
  return mikroRequest({ MethodName: 'YevmiyeListesi', Parameters: params }, config);
}

/** Banka hareketlerini çek (Mikro → Cetpa) */
export async function pullBankMovementsFromMikro(
  params: Record<string, unknown>,
  config: MikroConfig
): Promise<unknown> {
  return mikroRequest({ MethodName: 'BankaHareketListesi', Parameters: params }, config);
}
