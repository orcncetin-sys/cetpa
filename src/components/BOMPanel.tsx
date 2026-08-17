/**
 * BOMPanel.tsx — Bill of Materials (BOM Editor)
 *
 * Firestore collections used:
 *   bom       — BOM definitions  { productName, productSku, unit, description, components[] }
 *   inventory — read for component lookup (name/SKU autocomplete)
 *
 * NOTE: MRP / capacity planning has been consolidated into MRPModule.
 *   Use Envanter → MRP II to run material requirements planning,
 *   capacity load calculations, and auto-generate purchase orders.
 */

import { useState, useEffect } from 'react';
import {
  Factory, Plus, Trash2, Edit2, ChevronDown, ChevronUp,
  Package, RefreshCw, Search, X, ArrowRight,
} from 'lucide-react';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, getDocs, query,
} from '../lib/dbClient';
import { db } from '../firebase';
import { sortByCreatedAt } from '../utils/fsSort';
import { confirmAction } from '../lib/confirm';
import MikroPushButton from './MikroPushButton';
import { recetePayload } from '../services/mikroEvrak';
import { useMikroUretimReceteleri } from '../hooks/useMikroUretimReceteleri';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BOMComponent {
  inventoryId: string;  // Firestore inventory doc id (or '' for free-text)
  name:        string;
  sku:         string;
  quantity:    number;  // required per 1 unit of finished product
  unit:        string;  // 'adet' | 'kg' | 'm' | etc.
}

interface BOM {
  id:          string;
  productName: string;
  productSku:  string;
  unit:        string;
  description: string;
  components:  BOMComponent[];
  createdAt?:  unknown;
  updatedAt?:  unknown;
}

interface InventoryItem {
  id:       string;
  name:     string;
  sku:      string;
  quantity: number;
  unit?:    string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const UNITS = ['adet', 'kg', 'g', 'm', 'cm', 'lt', 'm²', 'm³', 'rol', 'kutu', 'palet', 'pk'];

function emptyBOM(): Omit<BOM, 'id'> {
  return { productName: '', productSku: '', unit: 'adet', description: '', components: [] };
}

function emptyComponent(): BOMComponent {
  return { inventoryId: '', name: '', sku: '', quantity: 1, unit: 'adet' };
}

// ── Main Component ────────────────────────────────────────────────────────────

interface BOMPanelProps {
  currentLanguage?: string;
}

export default function BOMPanel({ currentLanguage = 'tr' }: BOMPanelProps) {
  const tr = currentLanguage === 'tr';

  // ── State ──────────────────────────────────────────────────────────────────
  const [boms,      setBoms]      = useState<BOM[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  
  // ── MİKRO ENTEGRASYONU ──
  const [bomSourceTab, setBomSourceTab] = useState<'cetpa' | 'mikro'>('cetpa');
  const { receteler: mikroReceteler } = useMikroUretimReceteleri();
  
  const mikroBoms: BOM[] = mikroReceteler.map(r => ({
    id: r.rec_kod,
    productName: r.rec_isim || r.rec_kod,
    productSku: r.rec_ana_stok_kod || r.rec_kod,
    unit: 'adet',
    description: `Mikro Reçete: ${r.rec_kod} (Oluşturulma: ${r.rec_create_date?.split('T')[0] || '-'})`,
    components: []
  }));
  
  const activeBoms = bomSourceTab === 'cetpa' ? boms : mikroBoms;

  const [search,    setSearch]    = useState('');
  const [loading,   setLoading]   = useState(true);

  // Form state
  const [showForm,  setShowForm]  = useState(false);
  const [editing,   setEditing]   = useState<BOM | null>(null);
  const [form,      setForm]      = useState<Omit<BOM, 'id'>>(emptyBOM());
  const [saving,    setSaving]    = useState(false);

  // Expanded BOM cards
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Inventory search in component form
  const [invSearch, setInvSearch] = useState('');
  const [invOpen,   setInvOpen]   = useState<number | null>(null); // index of open dropdown

  // ── Firestore subscriptions ────────────────────────────────────────────────
  useEffect(() => {
    const q = query(collection(db, 'bom'));
    const unsub = onSnapshot(q, snap => {
      setBoms(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as BOM))));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  useEffect(() => {
    getDocs(collection(db, 'inventory')).then(snap => {
      setInventory(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryItem))));
    }).catch(() => {});
  }, []);

  // ── CRUD ───────────────────────────────────────────────────────────────────
  const openNew = () => {
    setEditing(null);
    setForm(emptyBOM());
    setShowForm(true);
  };

  const openEdit = (bom: BOM) => {
    setEditing(bom);
    setForm({ productName: bom.productName, productSku: bom.productSku, unit: bom.unit, description: bom.description, components: bom.components });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.productName.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await updateDoc(doc(db, 'bom', editing.id), { ...form, updatedAt: serverTimestamp() });
      } else {
        await addDoc(collection(db, 'bom'), { ...form, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      }
      setShowForm(false);
      setEditing(null);
      setForm(emptyBOM());
    } catch (e) {
      console.error('BOM save error:', e);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await confirmAction({
      title: tr ? 'BOM\'u Sil' : 'Delete BOM',
      message: tr
        ? 'Bu BOM\'u silmek istediğinize emin misiniz? Bu işlem geri alınamaz.'
        : 'Are you sure you want to delete this BOM? This cannot be undone.',
      confirmLabel: tr ? 'Sil' : 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    await deleteDoc(doc(db, 'bom', id));
  };

  // ── Component form helpers ─────────────────────────────────────────────────
  const addComponent = () =>
    setForm(f => ({ ...f, components: [...f.components, emptyComponent()] }));

  const updateComponent = (i: number, patch: Partial<BOMComponent>) =>
    setForm(f => ({ ...f, components: f.components.map((c, idx) => idx === i ? { ...c, ...patch } : c) }));

  const removeComponent = (i: number) =>
    setForm(f => ({ ...f, components: f.components.filter((_, idx) => idx !== i) }));

  const pickInventoryItem = (compIdx: number, item: InventoryItem) => {
    updateComponent(compIdx, { inventoryId: item.id, name: item.name, sku: item.sku, unit: item.unit || 'adet' });
    setInvOpen(null);
    setInvSearch('');
  };

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filtered = activeBoms.filter(b =>
    b.productName.toLowerCase().includes(search.toLowerCase()) ||
    b.productSku.toLowerCase().includes(search.toLowerCase())
  );

  const filteredInv = inventory.filter(i =>
    i.name.toLowerCase().includes(invSearch.toLowerCase()) ||
    i.sku.toLowerCase().includes(invSearch.toLowerCase())
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
            <Factory className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-gray-900">
              {tr ? 'Ürün Reçeteleri (BOM)' : 'Bill of Materials'}
            </h3>
            <p className="text-[11px] text-gray-400">
              {tr ? 'Bileşen yapısını tanımlayın — MRP planlaması için Envanter → MRP II' : 'Define component structure — for MRP planning see Inventory → MRP II'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <div className="flex bg-indigo-100/50 p-1 rounded-xl">
            <button
              onClick={() => setBomSourceTab('cetpa')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${bomSourceTab === 'cetpa' ? "bg-white text-indigo-600 shadow-sm" : "text-gray-500 hover:text-indigo-700"}`}
            >
              <Package className="w-4 h-4" />
              {tr ? 'Cetpa' : 'Cetpa'}
            </button>
            <button
              onClick={() => setBomSourceTab('mikro')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${bomSourceTab === 'mikro' ? "bg-white text-indigo-600 shadow-sm" : "text-gray-500 hover:text-indigo-700"}`}
            >
              <Factory className="w-4 h-4" />
              {tr ? 'Mikro' : 'Mikro'}
            </button>
          </div>
          {bomSourceTab === 'cetpa' && (
            <button onClick={openNew} className="flex items-center gap-1.5 py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-colors">
              <Plus className="w-3.5 h-3.5" />
              {tr ? 'Yeni Reçete' : 'New BOM'}
            </button>
          )}
        </div>
      </div>

      {/* ── MRP redirect banner ── */}
      <div className="flex items-center gap-3 p-3 bg-indigo-50 border border-indigo-100 rounded-2xl text-xs">
        <Package className="w-4 h-4 text-indigo-500 flex-shrink-0" />
        <p className="text-indigo-700 flex-1">
          {tr
            ? 'Malzeme ihtiyaç planlaması (MRP) ve kapasite analizi için:'
            : 'For material requirements planning (MRP) and capacity analysis:'}
        </p>
        <span className="flex items-center gap-1 font-bold text-indigo-600">
          {tr ? 'Envanter → MRP II' : 'Inventory → MRP II'}
          <ArrowRight className="w-3 h-3" />
        </span>
      </div>

      {/* ── BOM list ── */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder={tr ? 'Ürün adı veya SKU ara…' : 'Search product or SKU…'}
            className="w-full pl-8 pr-3 py-2 bg-white border border-gray-200 rounded-xl text-xs outline-none focus:border-indigo-400"
          />
        </div>
      </div>

      {loading && (
        <div className="space-y-3">
          {[1, 2].map(i => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-12 border-2 border-dashed border-gray-100 rounded-xl">
          <Factory className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-gray-400">{tr ? 'Henüz reçete yok.' : 'No BOMs defined yet.'}</p>
          <button onClick={openNew} className="mt-3 text-indigo-600 font-bold text-sm hover:underline">
            {tr ? '+ İlk reçeteyi oluştur' : '+ Create first BOM'}
          </button>
        </div>
      )}

      <div className="space-y-3">
        {filtered.map(bom => {
          const isExp = expanded[bom.id];
          return (
            <div key={bom.id} className="bg-white rounded-2xl border border-gray-100 transition-colors">
              {/* Card header */}
              <div className="flex items-center gap-3 p-4">
                <div className="w-9 h-9 bg-indigo-50 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Package className="w-4 h-4 text-indigo-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-gray-900 truncate">{bom.productName}</p>
                  <div className="flex items-center gap-2 text-[11px] text-gray-400">
                    <span className="font-mono">{bom.productSku}</span>
                    <span>•</span>
                    <span>{bom.components.length} {tr ? 'bileşen' : 'components'}</span>
                    <span>•</span>
                    <span>{bom.unit}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {bom.productSku && bom.components.length > 0 && (
                    <MikroPushButton
                      compact
                      method="UrunReceteKaydetV2"
                      entityType="bom"
                      entityId={bom.id}
                      buildPayload={() => recetePayload({
                        anaKod: bom.productSku,
                        anaMiktar: 1,
                        bilesenler: bom.components
                          .filter(c => c.sku)
                          .map(c => ({ sku: c.sku, miktar: c.quantity })),
                      })}
                    />
                  )}
                  {bomSourceTab === 'cetpa' && (
                    <>
                      <button onClick={() => openEdit(bom)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(bom.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setExpanded(e => ({ ...e, [bom.id]: !e[bom.id] }))}
                    className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    {isExp ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Components table */}
              {isExp && bom.components.length > 0 && (
                <div className="border-t border-gray-100 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left font-bold text-gray-400 uppercase text-[10px]">{tr ? 'Bileşen' : 'Component'}</th>
                        <th className="px-4 py-2 text-left font-bold text-gray-400 uppercase text-[10px]">SKU</th>
                        <th className="px-4 py-2 text-right font-bold text-gray-400 uppercase text-[10px]">{tr ? 'Miktar/Birim' : 'Qty/Unit'}</th>
                        <th className="px-4 py-2 text-right font-bold text-gray-400 uppercase text-[10px]">{tr ? 'Stok' : 'Stock'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {bom.components.map((c, i) => {
                        const invItem = inventory.find(inv => inv.id === c.inventoryId);
                        return (
                          <tr key={i} className="hover:bg-gray-50/50">
                            <td className="px-4 py-2 font-medium text-gray-800">{c.name}</td>
                            <td className="px-4 py-2 font-mono text-gray-500">{c.sku}</td>
                            <td className="px-4 py-2 text-right">{c.quantity} {c.unit}</td>
                            <td className="px-4 py-2 text-right font-bold">
                              {invItem != null
                                ? <span className={invItem.quantity > 0 ? 'text-emerald-600' : 'text-red-500'}>{invItem.quantity}</span>
                                : <span className="text-gray-300">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {isExp && bom.description && (
                <p className="px-4 py-2 text-[11px] text-gray-400 border-t border-gray-50">{bom.description}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* ── BOM Form Modal ── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-start justify-center p-4 pt-16 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl space-y-5 p-6">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-gray-900">
                {editing ? (tr ? 'Reçeteyi Düzenle' : 'Edit BOM') : (tr ? 'Yeni Reçete' : 'New BOM')}
              </h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>

            {/* Product info */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">{tr ? 'Ürün Adı' : 'Product Name'} *</label>
                <input
                  value={form.productName}
                  onChange={e => setForm(f => ({ ...f, productName: e.target.value }))}
                  className="w-full mt-0.5 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-400"
                  placeholder={tr ? 'Mamul ürün adı' : 'Finished product name'}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">SKU</label>
                <input
                  value={form.productSku}
                  onChange={e => setForm(f => ({ ...f, productSku: e.target.value }))}
                  className="w-full mt-0.5 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono outline-none focus:border-indigo-400"
                  placeholder="FP-001"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">{tr ? 'Birim' : 'Unit'}</label>
                <select
                  value={form.unit}
                  onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                  className="w-full mt-0.5 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-400"
                >
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">{tr ? 'Açıklama' : 'Description'}</label>
                <input
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full mt-0.5 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-400"
                  placeholder={tr ? 'İsteğe bağlı açıklama' : 'Optional description'}
                />
              </div>
            </div>

            {/* Components */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-gray-600 uppercase">{tr ? 'Bileşenler' : 'Components'}</h4>
                <button onClick={addComponent} className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-bold">
                  <Plus className="w-3.5 h-3.5" /> {tr ? 'Ekle' : 'Add'}
                </button>
              </div>

              {form.components.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-3 border border-dashed border-gray-200 rounded-xl">
                  {tr ? 'Henüz bileşen yok. "Ekle" butonuna basın.' : 'No components yet. Press Add.'}
                </p>
              )}

              {form.components.map((comp, i) => (
                <div key={i} className="border border-gray-100 rounded-xl p-3 space-y-2 bg-gray-50/50">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-gray-400">#{i + 1}</span>
                    <button onClick={() => removeComponent(i)} className="text-gray-300 hover:text-red-500 transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {/* Inventory picker */}
                    <div className="col-span-2 relative">
                      <label className="text-[10px] font-bold text-gray-400 uppercase">{tr ? 'Envanter\'den Seç veya Manuel Gir' : 'Pick from Inventory or Enter Manually'}</label>
                      <div className="relative mt-0.5">
                        <input
                          value={invOpen === i ? invSearch : (comp.name || '')}
                          onFocus={() => { setInvOpen(i); setInvSearch(comp.name || ''); }}
                          onChange={e => { setInvSearch(e.target.value); updateComponent(i, { name: e.target.value }); }}
                          placeholder={tr ? 'Malzeme ara…' : 'Search material…'}
                          className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-indigo-400"
                        />
                        {invOpen === i && filteredInv.length > 0 && (
                          <div className="absolute z-10 top-full left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg max-h-36 overflow-y-auto mt-1">
                            {filteredInv.slice(0, 8).map(item => (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => pickInventoryItem(i, item)}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-indigo-50 flex items-center justify-between"
                              >
                                <span className="font-medium">{item.name}</span>
                                <span className="font-mono text-gray-400">{item.sku}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase">SKU</label>
                      <input
                        value={comp.sku}
                        onChange={e => updateComponent(i, { sku: e.target.value })}
                        className="w-full mt-0.5 bg-white border border-gray-200 rounded-xl px-3 py-1.5 text-xs font-mono outline-none focus:border-indigo-400"
                        placeholder="MAT-001"
                      />
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="text-[10px] font-bold text-gray-400 uppercase">{tr ? 'Miktar' : 'Qty'}</label>
                        <input
                          type="number" min={0.001} step={0.001}
                          value={comp.quantity}
                          onChange={e => updateComponent(i, { quantity: parseFloat(e.target.value) || 1 })}
                          className="w-full mt-0.5 bg-white border border-gray-200 rounded-xl px-3 py-1.5 text-xs outline-none focus:border-indigo-400"
                        />
                      </div>
                      <div className="w-20">
                        <label className="text-[10px] font-bold text-gray-400 uppercase">{tr ? 'Birim' : 'Unit'}</label>
                        <select
                          value={comp.unit}
                          onChange={e => updateComponent(i, { unit: e.target.value })}
                          className="w-full mt-0.5 bg-white border border-gray-200 rounded-xl px-2 py-1.5 text-xs outline-none focus:border-indigo-400"
                        >
                          {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm font-bold hover:bg-gray-50">
                {tr ? 'İptal' : 'Cancel'}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.productName.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold transition-colors disabled:opacity-40"
              >
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                {saving ? (tr ? 'Kaydediliyor…' : 'Saving…') : (tr ? 'Kaydet' : 'Save')}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
