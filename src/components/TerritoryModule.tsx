/**
 * TerritoryModule — Satış Bölgesi & Temsilci Yönetimi
 * Gap vs competitors: HubSpot Enterprise, Zoho CRM, NetSuite
 *
 * Features:
 *  - Territory CRUD with city/region assignment rules
 *  - Rep quota targets vs actuals (pulled from orders)
 *  - Territory-level pipeline funnel
 *  - Auto-routing: assign new lead/customer to territory by city
 *  - Overlap & coverage map (text-based heat)
 */

import { useState, useEffect } from 'react';
import { confirmDelete } from '../lib/confirm';
import { motion, AnimatePresence } from 'motion/react';
import {
  MapPin, Plus, X, Target, Users, Edit2, Trash2, BarChart2, Award
} from 'lucide-react';
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, serverTimestamp, query
} from '../lib/dbClient';
import { db } from '../firebase';
import { byField } from '../utils/fsSort';
import ModuleHeader from './ModuleHeader';
import { useCountryList, useCitiesForCountry } from '../hooks/useWorldGeo';

// ─── Types ─────────────────────────────────────────────────────────────────

interface Territory {
  id: string;
  name: string;
  description: string;
  cities: string[];          // list of city/region names in this territory
  // Şehirler önceden serbest metindi (virgülle ayrılmış) — yazım hatası/eşleşmeyen
  // isim kolaydı. Artık ülke seçilip o ülkenin gerçek şehir listesinden eklenir
  // (2026-08-17, kullanıcı: "tüm dünyadaki şehirleri göm, ülke seçimi ekle").
  // countryCode opsiyonel — eski bölgelerde yok, geriye dönük kırmaz.
  countryCode?: string;       // ISO2, ör. 'TR'
  repName: string;
  repEmail?: string;
  revenueTarget: number;     // annual revenue quota (TRY)
  currency: string;
  color: string;             // hex badge colour
  active: boolean;
  createdAt?: unknown;
}

interface Props {
  currentLanguage: string;
  isAuthenticated: boolean;
  /** Pass real orders so we can compute territory actuals */
  orders?: Array<{ id: string; customerName: string; totalPrice?: number; deliveryCity?: string; city?: string; createdAt?: unknown }>;
  /** Pass real leads/customers */
  leads?: Array<{ id: string; company?: string; name?: string; city?: string; status?: string }>;
}

// ─── Colours ───────────────────────────────────────────────────────────────

const TERRITORY_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#ec4899',
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function cityInTerritory(city: string, territory: Territory): boolean {
  if (!city) return false;
  // Salt .toLowerCase() Türkçe 'İ'yi 'i' değil 'i̇' (nokta + birleşik aksan)
  // yapar — "İstanbul" artık dünya veritabanından doğru aksanla geldiği için
  // (2026-08-17) düz ASCII "Istanbul" içeren sipariş/lead kayıtlarıyla
  // eşleşmeyi code-review'da SESSİZCE kırardı. toLocaleLowerCase('tr-TR')
  // İ→i, I→ı doğru katlar.
  const c = city.toLocaleLowerCase('tr-TR').trim();
  return territory.cities.some(t => {
    const tl = t.toLocaleLowerCase('tr-TR');
    return c.includes(tl) || tl.includes(c);
  });
}

function pct(actual: number, target: number): number {
  if (!target) return 0;
  return Math.min(200, Math.round((actual / target) * 100));
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function TerritoryModule({ currentLanguage, isAuthenticated, orders = [], leads = [] }: Props) {
  const tr = currentLanguage === 'tr';

  const [territories, setTerritories] = useState<Territory[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedTerritoryId, setSelectedTerritoryId] = useState<string | null>(null);
  // Şehir eklemek için yazılmakta olan metin (tek tek "Ekle" ile draft.cities'e girer) —
  // eski serbest-metin virgüllü giriş yerine (2026-08-17).
  const [cityPickerInput, setCityPickerInput] = useState('');

  const emptyDraft: Omit<Territory, 'id' | 'createdAt'> = {
    name: '', description: '', cities: [], countryCode: '', repName: '', repEmail: '',
    revenueTarget: 0, currency: 'TRY', color: TERRITORY_COLORS[0], active: true,
  };
  const [draft, setDraft] = useState(emptyDraft);
  const countryList = useCountryList(tr ? 'tr' : 'en');
  const countryCities = useCitiesForCountry(draft.countryCode || null);

  const addCityToDraft = (raw: string) => {
    const name = raw.trim();
    if (!name || draft.cities.includes(name)) { setCityPickerInput(''); return; }
    setDraft(d => ({ ...d, cities: [...d.cities, name] }));
    setCityPickerInput('');
  };
  const removeCityFromDraft = (name: string) => {
    setDraft(d => ({ ...d, cities: d.cities.filter(c => c !== name) }));
  };

  // ── Firestore listener ────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'territories')), snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Territory))
        .sort(byField<Territory>('name', 'asc'));
      setTerritories(data);
    });
    return () => unsub();
  }, []);

  // ── Derived stats per territory ────────────────────────────────────────────
  function territoryStats(t: Territory) {
    const matchedOrders = orders.filter(o => {
      const city = (o.deliveryCity ?? o.city ?? '');
      return cityInTerritory(city, t);
    });
    const actual = matchedOrders.reduce((s, o) => s + (o.totalPrice ?? 0), 0);
    const matchedLeads = leads.filter(l => cityInTerritory(l.city ?? '', t));
    return { actual, ordersCount: matchedOrders.length, leadsCount: matchedLeads.length };
  }

  // ── Save / update ──────────────────────────────────────────────────────────
  const saveDraft = async () => {
    if (!draft.name.trim() || !draft.repName.trim()) return;
    const payload = { ...draft };
    if (editingId) {
      await updateDoc(doc(db, 'territories', editingId), payload);
    } else {
      await addDoc(collection(db, 'territories'), { ...payload, createdAt: serverTimestamp() });
    }
    setShowForm(false);
    setEditingId(null);
    setDraft(emptyDraft);
    setCityPickerInput('');
  };

  const startEdit = (t: Territory) => {
    setDraft({ name: t.name, description: t.description, cities: t.cities, countryCode: t.countryCode || '',
      repName: t.repName, repEmail: t.repEmail ?? '', revenueTarget: t.revenueTarget, currency: t.currency,
      color: t.color, active: t.active });
    setCityPickerInput('');
    setEditingId(t.id);
    setShowForm(true);
  };

  const deleteTerritry = async (id: string) => {
    const t = territories.find(x => x.id === id);
    if (!await confirmDelete(t?.name, currentLanguage === 'tr' ? 'tr' : 'en')) return;
    await deleteDoc(doc(db, 'territories', id));
    if (selectedTerritoryId === id) setSelectedTerritoryId(null);
  };

  // ── KPI strip ─────────────────────────────────────────────────────────────
  const totalActual = territories.reduce((s, t) => s + territoryStats(t).actual, 0);
  const totalTarget = territories.reduce((s, t) => s + t.revenueTarget, 0);
  const covered = new Set(territories.flatMap(t => t.cities)).size;
  const totalLeads = leads.length;
  const assignedLeads = leads.filter(l => territories.some(t => cityInTerritory(l.city ?? '', t))).length;

  const selectedTerritory = territories.find(t => t.id === selectedTerritoryId) ?? null;
  const selectedStats = selectedTerritory ? territoryStats(selectedTerritory) : null;

  const fmtTRY = (v: number) => `₺${Math.round(v).toLocaleString('tr-TR')}`;

  return (
    <div className="space-y-4">
      <ModuleHeader
        title={tr ? 'Satış Bölgesi Yönetimi' : 'Territory Management'}
        subtitle={tr ? 'Bölge bazlı satış temsilcisi atama, kota takibi ve boru hattı görünümü' : 'Rep assignment, quota tracking and pipeline by territory'}
        icon={MapPin}
        actionButton={isAuthenticated ? (
          <button onClick={() => { setShowForm(true); setEditingId(null); setDraft(emptyDraft); setCityPickerInput(''); }}
            className="apple-button-primary px-4 py-2 text-sm flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" />{tr ? 'Bölge Ekle' : 'Add Territory'}
          </button>
        ) : undefined}
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: tr ? 'Toplam Bölge' : 'Territories', v: territories.length, sub: `${territories.filter(t=>t.active).length} aktif`, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: tr ? 'Toplam Hedef' : 'Total Target', v: fmtTRY(totalTarget), sub: tr ? 'Yıllık kota' : 'Annual quota', color: 'text-indigo-600', bg: 'bg-indigo-50' },
          { label: tr ? 'Gerçekleşen' : 'Actual Revenue', v: fmtTRY(totalActual), sub: `%${pct(totalActual, totalTarget)} ${tr ? 'hedef' : 'of target'}`, color: totalActual >= totalTarget * 0.9 ? 'text-green-600' : 'text-orange-600', bg: totalActual >= totalTarget * 0.9 ? 'bg-green-50' : 'bg-orange-50' },
          { label: tr ? 'Kapsama' : 'Lead Coverage', v: `${assignedLeads}/${totalLeads}`, sub: `${covered} ${tr ? 'şehir' : 'cities'}`, color: 'text-teal-600', bg: 'bg-teal-50' },
        ].map(k => (
          <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-0.5">{k.label}</p>
            <p className={`text-xl font-bold ${k.color}`}>{k.v}</p>
            <p className="text-xs text-gray-400 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Add / Edit form */}
      <AnimatePresence>
        {showForm && (
          <motion.div key="form" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="apple-card p-5 border-2 border-brand/20 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-gray-800">{editingId ? (tr ? 'Bölge Düzenle' : 'Edit Territory') : (tr ? 'Yeni Bölge' : 'New Territory')}</h4>
              <button onClick={() => setShowForm(false)}><X className="w-4 h-4 text-gray-400" /></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label htmlFor="territory-name" className="sr-only">{tr ? 'Bölge adı' : 'Territory name'}</label>
                <input id="territory-name" name="territoryName" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                  placeholder={tr ? 'Bölge adı (ör: İstanbul Avrupa)' : 'Territory name (e.g. Istanbul West)'}
                  className="apple-input px-3 py-2 text-sm w-full" />
              </div>
              <div>
                <label htmlFor="territory-rep" className="sr-only">{tr ? 'Sorumlu Temsilci' : 'Assigned Rep'}</label>
                <input id="territory-rep" name="repName" value={draft.repName} onChange={e => setDraft(d => ({ ...d, repName: e.target.value }))}
                  placeholder={tr ? 'Sorumlu Temsilci' : 'Assigned Rep'} className="apple-input px-3 py-2 text-sm w-full" />
              </div>
              <div>
                <label htmlFor="territory-rep-email" className="sr-only">{tr ? 'Temsilci e-posta' : 'Rep email'}</label>
                <input id="territory-rep-email" name="repEmail" type="email" value={draft.repEmail ?? ''} onChange={e => setDraft(d => ({ ...d, repEmail: e.target.value }))}
                  placeholder={tr ? 'Temsilci e-posta (opsiyonel)' : 'Rep email (optional)'} className="apple-input px-3 py-2 text-sm w-full" />
              </div>
              <div>
                <label htmlFor="territory-country" className="sr-only">{tr ? 'Ülke' : 'Country'}</label>
                <select id="territory-country" name="countryCode" value={draft.countryCode || ''} onChange={e => { setDraft(d => ({ ...d, countryCode: e.target.value })); setCityPickerInput(''); }}
                  className="apple-input px-3 py-2 text-sm w-full">
                  <option value="">{tr ? 'Ülke seçin' : 'Select country'}</option>
                  {countryList.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="territory-quota" className="sr-only">{tr ? 'Yıllık Kota' : 'Annual Quota'}</label>
                <input id="territory-quota" name="revenueTarget" type="number" value={draft.revenueTarget || ''} onChange={e => setDraft(d => ({ ...d, revenueTarget: parseFloat(e.target.value) || 0 }))}
                  placeholder={tr ? 'Yıllık Kota (₺)' : 'Annual Quota (₺)'} className="apple-input px-3 py-2 text-sm w-full" />
              </div>
              <div className="md:col-span-2">
                <label htmlFor="territory-city-picker" className="text-xs font-semibold text-gray-600 mb-1 block">{tr ? 'Şehirler' : 'Cities'}</label>
                <div className="flex gap-2">
                  {/* Ülke seçilmemişse (ör. 2026-08-17 öncesi eski bölgeler) alan
                      KİLİTLENMEZ — yalnız otomatik tamamlama listesi boş kalır,
                      serbest yazıp Enter/Ekle ile eklemeye devam edilebilir
                      (code-review bulgusu: eski bölgeleri düzenlemeyi kırıyordu). */}
                  <input id="territory-city-picker" name="cityPicker" list="territoryCityList" value={cityPickerInput} onChange={e => setCityPickerInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCityToDraft(cityPickerInput); } }}
                    placeholder={draft.countryCode ? (tr ? 'Şehir yazın, listeden seçin ya da Enter\'a basın' : 'Type a city, pick from the list, or press Enter') : (tr ? 'Şehir yazın (öneri için önce ülke seçin)' : 'Type a city (select a country for suggestions)')}
                    className="apple-input px-3 py-2 text-sm flex-1" />
                  <datalist id="territoryCityList">
                    {countryCities.map(c => <option key={c} value={c} />)}
                  </datalist>
                  <button type="button" onClick={() => addCityToDraft(cityPickerInput)} disabled={!cityPickerInput.trim()}
                    className="apple-button-secondary px-3 py-2 text-sm disabled:opacity-40">{tr ? 'Ekle' : 'Add'}</button>
                </div>
                {draft.cities.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {draft.cities.map(c => (
                      <span key={c} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                        {c}
                        <button type="button" onClick={() => removeCityFromDraft(c)} className="hover:text-red-500"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-600">{tr ? 'Renk' : 'Color'}</span>
                <div className="flex gap-1.5 flex-wrap" role="radiogroup" aria-label={tr ? 'Renk' : 'Color'}>
                  {TERRITORY_COLORS.map(c => (
                    <button key={c} type="button" role="radio" aria-checked={draft.color === c} aria-label={c} onClick={() => setDraft(d => ({ ...d, color: c }))}
                      className={`w-6 h-6 rounded-full transition-transform ${draft.color === c ? 'scale-125 ring-2 ring-offset-1 ring-gray-400' : ''}`}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>
              <div className="md:col-span-2">
                <label htmlFor="territory-description" className="sr-only">{tr ? 'Açıklama' : 'Description'}</label>
                <textarea id="territory-description" name="description" value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                  placeholder={tr ? 'Açıklama (opsiyonel)' : 'Description (optional)'}
                  className="apple-input px-3 py-2 text-sm w-full resize-none" rows={2} />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={saveDraft} className="apple-button-primary px-4 py-2 text-sm">
                {editingId ? (tr ? 'Güncelle' : 'Update') : (tr ? 'Oluştur' : 'Create')}
              </button>
              <button onClick={() => setShowForm(false)} className="apple-button-secondary px-4 py-2 text-sm">{tr ? 'İptal' : 'Cancel'}</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Territory grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {territories.map(t => {
          const stats = territoryStats(t);
          const p = pct(stats.actual, t.revenueTarget);
          const isSelected = selectedTerritoryId === t.id;
          return (
            <motion.div key={t.id} layout
              className={`apple-card p-4 space-y-3 cursor-pointer transition-shadow ${isSelected ? 'ring-2 ring-brand/40' : 'hover:shadow-md'}`}
              onClick={() => setSelectedTerritoryId(isSelected ? null : t.id)}>
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                  <div>
                    <p className="font-bold text-gray-900 text-sm">{t.name}</p>
                    <p className="text-xs text-gray-500 flex items-center gap-1">
                      <Users className="w-3 h-3" /> {t.repName}
                    </p>
                  </div>
                </div>
                {isAuthenticated && (
                  <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                    <button onClick={() => startEdit(t)} className="p-1 rounded-lg hover:bg-gray-100">
                      <Edit2 className="w-3.5 h-3.5 text-gray-400" />
                    </button>
                    <button onClick={() => deleteTerritry(t.id)} className="p-1 rounded-lg hover:bg-red-50">
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  </div>
                )}
              </div>

              {/* Quota progress */}
              {t.revenueTarget > 0 && (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-500">{tr ? 'Kota' : 'Quota'}</span>
                    <span className={`font-bold ${p >= 100 ? 'text-green-600' : p >= 70 ? 'text-amber-600' : 'text-red-500'}`}>{p}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${Math.min(100, p)}%`, backgroundColor: p >= 100 ? '#10b981' : p >= 70 ? '#f59e0b' : '#ef4444' }} />
                  </div>
                  <div className="flex justify-between text-xs mt-0.5 text-gray-400">
                    <span>{Math.round(stats.actual).toLocaleString('tr-TR')} ₺</span>
                    <span>{Math.round(t.revenueTarget).toLocaleString('tr-TR')} ₺</span>
                  </div>
                </div>
              )}

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: tr ? 'Sipariş' : 'Orders', v: stats.ordersCount, icon: BarChart2 },
                  { label: tr ? 'Lead' : 'Leads', v: stats.leadsCount, icon: Target },
                  { label: tr ? 'Şehir' : 'Cities', v: t.cities.length, icon: MapPin },
                ].map(s => (
                  <div key={s.label} className="bg-gray-50 rounded-lg p-2 text-center">
                    <p className="text-lg font-bold text-gray-800">{s.v}</p>
                    <p className="text-[10px] text-gray-400 uppercase font-bold">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Cities chip list */}
              {t.cities.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {t.cities.slice(0, 4).map(c => (
                    <span key={c} className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: `${t.color}22`, color: t.color }}>{c}</span>
                  ))}
                  {t.cities.length > 4 && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">+{t.cities.length - 4}</span>
                  )}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Selected territory drill-down */}
      <AnimatePresence>
        {selectedTerritory && selectedStats && (
          <motion.div key="detail" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            className="apple-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full" style={{ backgroundColor: selectedTerritory.color }} />
                <h3 className="font-bold text-gray-900">{selectedTerritory.name} — {tr ? 'Detay' : 'Detail'}</h3>
              </div>
              <button onClick={() => setSelectedTerritoryId(null)}>
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>

            {/* Rep info */}
            <div className="bg-blue-50 rounded-xl p-3 flex items-center gap-3">
              <Award className="w-5 h-5 text-blue-600 flex-shrink-0" />
              <div>
                <p className="font-semibold text-blue-900 text-sm">{selectedTerritory.repName}</p>
                {selectedTerritory.repEmail && <p className="text-xs text-blue-600">{selectedTerritory.repEmail}</p>}
              </div>
              {selectedTerritory.revenueTarget > 0 && (
                <div className="ml-auto text-right">
                  <p className="text-xs text-blue-400">{tr ? 'Yıllık Kota' : 'Annual Quota'}</p>
                  <p className="font-bold text-blue-800">₺{Math.round(selectedTerritory.revenueTarget).toLocaleString('tr-TR')}</p>
                </div>
              )}
            </div>

            {/* Leads in territory */}
            {(() => {
              const terrLeads = leads.filter(l => cityInTerritory(l.city ?? '', selectedTerritory));
              if (terrLeads.length === 0) return (
                <p className="text-sm text-gray-400 text-center py-4">
                  {tr ? 'Bu bölgede henüz lead/müşteri yok.' : 'No leads/customers in this territory yet.'}
                </p>
              );
              return (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{tr ? 'Bölgedeki Müşteri / Adaylar' : 'Customers & Leads in Territory'}</p>
                  <div className="divide-y divide-gray-50">
                    {terrLeads.slice(0, 8).map(l => (
                      <div key={l.id} className="flex items-center justify-between py-2">
                        <div>
                          <p className="text-sm font-medium text-gray-800">{l.company ?? l.name ?? l.id}</p>
                          <p className="text-xs text-gray-400">{l.city}</p>
                        </div>
                        {l.status && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{l.status}</span>
                        )}
                      </div>
                    ))}
                    {terrLeads.length > 8 && (
                      <p className="text-xs text-gray-400 text-center pt-2">+{terrLeads.length - 8} {tr ? 'daha' : 'more'}</p>
                    )}
                  </div>
                </div>
              );
            })()}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty state */}
      {territories.length === 0 && !showForm && (
        <div className="apple-card p-12 text-center space-y-3">
          <MapPin className="w-12 h-12 text-gray-200 mx-auto" />
          <p className="font-semibold text-gray-500">{tr ? 'Henüz bölge tanımlanmamış' : 'No territories defined yet'}</p>
          <p className="text-sm text-gray-400 max-w-sm mx-auto">
            {tr
              ? 'Satış temsilcilerinize bölge atayın, kota hedeflerini belirleyin ve bölge bazlı performansı takip edin.'
              : 'Assign reps to territories, set quota targets, and track performance by region.'}
          </p>
          {isAuthenticated && (
            <button onClick={() => setShowForm(true)} className="apple-button-primary px-5 py-2 text-sm mx-auto flex items-center gap-2">
              <Plus className="w-4 h-4" />{tr ? 'İlk Bölgeyi Oluştur' : 'Create First Territory'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
