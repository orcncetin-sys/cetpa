/**
 * UrunAgaciModule — Ürün Ağacı (BOM: Bill of Materials) tanımlama ekranı.
 *
 * NEDEN VAR (2026-09-04, kullanıcı isteği "yaz"):
 * MRP II modülü `boms` prop'unu bekliyor ve MRP patlatması (BOM explosion) buna
 * dayanıyor — ama projede ürün ağacı diye bir veri kaynağı HİÇ YOKTU: koleksiyon
 * yok, ekran yok, callsite `boms={[]}` geçiyordu. Yani MRP'nin "hangi ürün için
 * hangi bileşenler ne kadar gerekir" hesabı hiçbir zaman çalışamıyordu; ekranda
 * yalnız üretim önerisi çıkıyor, malzeme ihtiyacı çıkmıyordu.
 *
 * VERİ ŞEKLİ MRPModule'ün beklediğiyle BİREBİR (src/components/MRPModule.tsx):
 *   { id, productName, productSku, components: [{ inventoryId, name, quantity, unit }] }
 * Alan adı değiştirilirse MRP patlatması sessizce boş döner — şekli bozmadan
 * alan EKLEMEK serbesttir.
 *
 * SKU ESLEME (Şube transferiyle aynı ilke, kullanıcı kararı): hem mamul hem
 * bileşenler envanterden SKU ile seçilir, bağlı ad kaydedilir ve ekranda görünür.
 * Envanterde olmayan bir bileşen de yazılabilir (fason/ham madde henüz tanımlı
 * olmayabilir) — o durumda uyarı gösterilir, kayıt engellenmez.
 */
import { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, query } from '../lib/dbClient';
import { db } from '../firebase';
import { confirmDelete } from '../lib/confirm';
import { Plus, X, Save, Trash2, Pencil, Layers, AlertTriangle, Search } from 'lucide-react';
import { logFirestoreError, OperationType } from '../utils/firebase';
import { auth } from '../firebase';

export interface BomBilesen {
  inventoryId: string;
  name: string;
  sku?: string;
  quantity: number;
  unit: string;
}

export interface UrunAgaci {
  id: string;
  productName: string;
  productSku: string;
  components: BomBilesen[];
  aciklama?: string;
  createdAt?: unknown;
}

interface Props {
  currentLanguage: string;
  isAuthenticated: boolean;
  inventory?: Array<{ id: string; name: string; sku: string; unit?: string }>;
}

export default function UrunAgaciModule({ currentLanguage, isAuthenticated, inventory = [] }: Props) {
  const tr = currentLanguage === 'tr';
  const [agaclar, setAgaclar] = useState<UrunAgaci[]>([]);
  const [search, setSearch] = useState('');
  const [modalAcik, setModalAcik] = useState(false);
  const [duzenlenenId, setDuzenlenenId] = useState<string | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const bosForm = { productName: '', productSku: '', aciklama: '', components: [] as BomBilesen[] };
  const [form, setForm] = useState(bosForm);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'urunAgaclari')), snap => {
      setAgaclar(snap.docs
        .map(d => ({ id: d.id, ...d.data() } as UrunAgaci))
        .sort((a, b) => (a.productName || '').localeCompare(b.productName || '', 'tr')));
    }, err => logFirestoreError(err, OperationType.LIST, 'urunAgaclari', auth.currentUser?.uid));
    return () => unsub();
  }, []);

  const skudanUrun = (sku: string) => inventory.find(i => i.sku === sku.trim());

  const bilesenEkle = () =>
    setForm(f => ({ ...f, components: [...f.components, { inventoryId: '', name: '', sku: '', quantity: 1, unit: 'ADET' }] }));

  const bilesenGuncelle = (ix: number, yeni: Partial<BomBilesen>) =>
    setForm(f => ({ ...f, components: f.components.map((c, i) => (i === ix ? { ...c, ...yeni } : c)) }));

  const bilesenSil = (ix: number) =>
    setForm(f => ({ ...f, components: f.components.filter((_, i) => i !== ix) }));

  const kaydet = async () => {
    if (!form.productSku.trim() || form.components.length === 0) return;
    setKaydediliyor(true);
    try {
      // MRP patlatması `productName` ile eşleştirir (MRPModule:215) — mamul
      // envanterde bulunamazsa adı boş bırakma, SKU'yu ad olarak yaz ki
      // eşleştirme yine de bir şeye denk gelsin.
      const mamul = skudanUrun(form.productSku);
      const govde = {
        productSku: form.productSku.trim(),
        productName: (form.productName || mamul?.name || form.productSku).trim(),
        aciklama: form.aciklama.trim(),
        components: form.components
          .filter(c => c.name.trim() || c.sku?.trim())
          .map(c => ({
            inventoryId: c.inventoryId,
            name: c.name,
            sku: c.sku ?? '',
            quantity: Number(c.quantity) || 0,
            unit: c.unit || 'ADET',
          })),
      };
      if (duzenlenenId) {
        await updateDoc(doc(db, 'urunAgaclari', duzenlenenId), govde);
      } else {
        await addDoc(collection(db, 'urunAgaclari'), { ...govde, createdAt: serverTimestamp() });
      }
      setModalAcik(false); setForm(bosForm); setDuzenlenenId(null);
    } catch (err) {
      logFirestoreError(err, duzenlenenId ? OperationType.UPDATE : OperationType.CREATE, 'urunAgaclari', auth.currentUser?.uid);
    }
    setKaydediliyor(false);
  };

  const duzenle = (a: UrunAgaci) => {
    setDuzenlenenId(a.id);
    setForm({
      productName: a.productName ?? '',
      productSku: a.productSku ?? '',
      aciklama: a.aciklama ?? '',
      components: (a.components ?? []).map(c => ({ ...c, sku: c.sku ?? '' })),
    });
    setModalAcik(true);
  };

  const sil = async (a: UrunAgaci) => {
    if (!(await confirmDelete(tr ? `"${a.productName}" ürün ağacı silinsin mi?` : `Delete BOM "${a.productName}"?`))) return;
    try { await deleteDoc(doc(db, 'urunAgaclari', a.id)); }
    catch (err) { logFirestoreError(err, OperationType.DELETE, 'urunAgaclari', auth.currentUser?.uid); }
  };

  const filtrelenmis = agaclar.filter(a =>
    !search ||
    (a.productName ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (a.productSku ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (a.components ?? []).some(c => (c.name ?? '').toLowerCase().includes(search.toLowerCase())));

  const mamulEslesme = skudanUrun(form.productSku);

  return (
    <div className="space-y-4">
      <datalist id="cetpa-bom-urun-listesi">
        {inventory.map(i => <option key={i.id} value={i.sku}>{i.name}</option>)}
      </datalist>

      <div className="apple-card p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-brand" />
            <div>
              <h3 className="font-bold text-gray-900 text-sm">{tr ? 'Ürün Ağacı (BOM)' : 'Bill of Materials'}</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {tr
                  ? 'Bir mamulün hangi bileşenlerden ne kadar gerektiğini tanımlar. MRP II malzeme ihtiyacını buradan hesaplar.'
                  : 'Defines components per finished product. MRP II explodes material needs from here.'}
              </p>
            </div>
          </div>
          {isAuthenticated && (
            <button onClick={() => { setForm(bosForm); setDuzenlenenId(null); setModalAcik(true); }}
              className="apple-button-primary text-sm flex items-center gap-2">
              <Plus className="w-4 h-4" />{tr ? 'Ürün Ağacı Ekle' : 'Add BOM'}
            </button>
          )}
        </div>

        {agaclar.length > 0 && (
          <div className="relative mt-4">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder={tr ? 'Mamul, SKU veya bileşen ara…' : 'Search product, SKU or component…'}
              className="apple-input w-full pl-9 pr-3 py-2 text-sm" />
          </div>
        )}
      </div>

      {filtrelenmis.length === 0 ? (
        <div className="apple-card p-8 text-center">
          <Layers className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">
            {agaclar.length === 0
              ? (tr ? 'Henüz ürün ağacı tanımlanmadı.' : 'No BOMs defined yet.')
              : (tr ? 'Aramaya uyan ürün ağacı yok.' : 'No BOM matches your search.')}
          </p>
          {agaclar.length === 0 && (
            <p className="text-xs text-gray-400 mt-1">
              {tr
                ? 'Ürün ağacı tanımlanmadan MRP II malzeme ihtiyacı hesaplayamaz.'
                : 'Without a BOM, MRP II cannot compute material requirements.'}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtrelenmis.map(a => (
            <div key={a.id} className="apple-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 text-sm">{a.productName}</p>
                  <p className="text-[11px] text-gray-400 font-mono">{a.productSku}</p>
                  {a.aciklama && <p className="text-xs text-gray-500 mt-1">{a.aciklama}</p>}
                </div>
                {isAuthenticated && (
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => duzenle(a)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400" title={tr ? 'Düzenle' : 'Edit'}>
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => sil(a)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400" title={tr ? 'Sil' : 'Delete'}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
              <div className="mt-3 border-t border-gray-100 pt-2 space-y-1">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                  {tr ? `Bileşenler (${(a.components ?? []).length})` : `Components (${(a.components ?? []).length})`}
                </p>
                {(a.components ?? []).map((c, ix) => (
                  <div key={ix} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-gray-700 truncate">
                      {c.name || c.sku || '—'}
                      {c.sku && c.name && <span className="text-gray-400 font-mono ml-1.5">{c.sku}</span>}
                    </span>
                    <span className="text-gray-600 tabular-nums flex-shrink-0">{c.quantity} {c.unit}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {modalAcik && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={e => { if (e.target === e.currentTarget) setModalAcik(false); }}>
          <div className="apple-card w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900">
                {duzenlenenId ? (tr ? 'Ürün Ağacını Düzenle' : 'Edit BOM') : (tr ? 'Yeni Ürün Ağacı' : 'New BOM')}
              </h3>
              <button onClick={() => setModalAcik(false)} className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  {tr ? 'Mamul SKU *' : 'Product SKU *'} <span className="font-normal text-gray-400">({tr ? 'eşleşme anahtarı' : 'match key'})</span>
                </label>
                <input list="cetpa-bom-urun-listesi" value={form.productSku}
                  onChange={e => {
                    const sku = e.target.value;
                    const m = skudanUrun(sku);
                    setForm(f => ({ ...f, productSku: sku, productName: m ? m.name : f.productName }));
                  }}
                  className="apple-input w-full" placeholder={tr ? 'SKU seçin veya yazın' : 'Pick or type SKU'} />
                {form.productSku && (
                  <p className={`text-[10px] mt-1 ${mamulEslesme ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {mamulEslesme
                      ? `✓ ${mamulEslesme.name}`
                      : (tr ? 'Envanterde yok — mamul adını elle yazabilirsiniz.' : 'Not in inventory — type the product name manually.')}
                  </p>
                )}
              </div>

              {!mamulEslesme && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">{tr ? 'Mamul Adı' : 'Product Name'}</label>
                  <input value={form.productName} onChange={e => setForm(f => ({ ...f, productName: e.target.value }))}
                    className="apple-input w-full" placeholder={tr ? 'Örn: Hazır Beton C30' : 'e.g. Ready-mix C30'} />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">{tr ? 'Açıklama' : 'Notes'}</label>
                <input value={form.aciklama} onChange={e => setForm(f => ({ ...f, aciklama: e.target.value }))}
                  className="apple-input w-full" placeholder={tr ? 'İsteğe bağlı' : 'Optional'} />
              </div>

              <div className="border-t border-gray-100 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-600">
                    {tr ? 'Bileşenler * (1 mamul için)' : 'Components * (per 1 unit)'}
                  </label>
                  <button onClick={bilesenEkle} className="apple-button-secondary text-xs px-3 py-1 flex items-center gap-1">
                    <Plus className="w-3 h-3" />{tr ? 'Bileşen' : 'Component'}
                  </button>
                </div>

                {form.components.length === 0 ? (
                  <p className="text-[11px] text-gray-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3" />
                    {tr ? 'En az bir bileşen ekleyin — MRP patlatması bunu kullanır.' : 'Add at least one component.'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {form.components.map((c, ix) => {
                      const eslesme = c.sku ? skudanUrun(c.sku) : undefined;
                      return (
                        <div key={ix} className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <input list="cetpa-bom-urun-listesi" value={c.sku ?? ''}
                              onChange={e => {
                                const sku = e.target.value;
                                const m = skudanUrun(sku);
                                bilesenGuncelle(ix, {
                                  sku,
                                  inventoryId: m?.id ?? '',
                                  name: m?.name ?? c.name,
                                  unit: m?.unit ?? c.unit,
                                });
                              }}
                              className="apple-input w-full text-sm" placeholder={tr ? 'Bileşen SKU' : 'Component SKU'} />
                            {c.sku && (
                              <p className={`text-[10px] mt-0.5 ${eslesme ? 'text-emerald-600' : 'text-amber-600'}`}>
                                {eslesme ? `✓ ${eslesme.name}` : (tr ? 'Envanterde yok' : 'Not in inventory')}
                              </p>
                            )}
                            {!eslesme && (
                              <input value={c.name} onChange={e => bilesenGuncelle(ix, { name: e.target.value })}
                                className="apple-input w-full text-sm mt-1" placeholder={tr ? 'Bileşen adı' : 'Component name'} />
                            )}
                          </div>
                          <input type="number" min={0} step="any" value={c.quantity}
                            onChange={e => bilesenGuncelle(ix, { quantity: Number(e.target.value) })}
                            className="apple-input w-20 text-sm flex-shrink-0" placeholder={tr ? 'Mik.' : 'Qty'} />
                          <input value={c.unit} onChange={e => bilesenGuncelle(ix, { unit: e.target.value })}
                            className="apple-input w-20 text-sm flex-shrink-0" placeholder={tr ? 'Birim' : 'Unit'} />
                          <button onClick={() => bilesenSil(ix)} className="p-2 rounded-lg hover:bg-red-50 text-red-400 flex-shrink-0">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={() => setModalAcik(false)} className="apple-button-secondary flex-1 text-sm">
                {tr ? 'Vazgeç' : 'Cancel'}
              </button>
              <button onClick={kaydet}
                disabled={kaydediliyor || !form.productSku.trim() || form.components.length === 0}
                className="apple-button-primary flex-1 text-sm flex items-center justify-center gap-1.5 disabled:opacity-50">
                <Save className="w-4 h-4" />{kaydediliyor ? (tr ? 'Kaydediliyor…' : 'Saving…') : (tr ? 'Kaydet' : 'Save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
