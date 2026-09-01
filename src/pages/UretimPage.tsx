/**
 * UretimPage — Üretim Yönetimi sekmesi.
 *
 * App.tsx'ten ÇIKARILDI (2026-08-31, App.tsx bölme hattı — production bloğu
 * ~215 satırdı). Davranış birebir korunmuştur, İKİ KÜÇÜK DÜZELTME dışında:
 *   1. Üretim emri oluşturmada başarı toast'ı İKİ KEZ atılıyordu (try içinde +
 *      hemen ardından koşulsuz) — teke indirildi.
 *   2. Kapasite Planlama'da `o.workCenter || tr ? 'Genel Hat' : '...'` öncelik
 *      hatası: `(workCenter || tr)` önce hesaplandığından TÜM emirler
 *      'Genel Hat'a yığılıyor, gerçek iş merkezi adları hiç kullanılmıyordu.
 *      Parantez eklendi: `o.workCenter || (tr ? 'Genel Hat' : 'General Line')`.
 */
import { motion } from 'motion/react';
import { Factory, Hash, Wrench, Plus, Edit2, Trash2 } from 'lucide-react';
import { db } from '../firebase';
import { doc, collection, addDoc, updateDoc, deleteDoc, serverTimestamp } from '../lib/dbClient';
import UnauthorizedView from '../components/UnauthorizedView';
import ReadOnlyBanner from '../components/ReadOnlyBanner';
import ProductionModule from '../components/ProductionModule';
import BOMPanel from '../components/BOMPanel';

export interface P605Line { id?: string; line: string; maxCap: number; planned: number; actual: number; }
export interface P605Draft { line: string; maxCap: string; planned: string; actual: string; }
export interface P624Order {
  id: string; productName: string; qty: number; workCenter?: string;
  plannedStart: string; plannedEnd: string; status: string; priority: 'Normal' | 'Acil';
}
export interface P624Draft {
  productName: string; qty: string; workCenter: string;
  plannedStart: string; plannedEnd: string; priority: 'Normal' | 'Acil';
  /** Bu sayfada kullanılmıyor ama App'teki state tipiyle birebir eşleşmeli —
   *  setter uyumluluğu (SetStateAction) alan eksikliğini kabul etmiyor. */
  status: 'Planlandı' | 'Üretimde' | 'Tamamlandı' | 'İptal';
}

interface Props {
  currentLanguage: 'tr' | 'en';
  isAuthenticated: boolean;
  canAccess: (tab: string) => boolean;
  hasFullAccess: (tab: string) => boolean;
  setActiveTab: (tab: string) => void;
  toast: (msg: string, tur?: 'success' | 'error' | 'info') => void;
  p605Capacity: P605Line[];
  p605ShowForm: boolean; setP605ShowForm: (updater: boolean | ((v: boolean) => boolean)) => void;
  p605Draft: P605Draft; setP605Draft: (updater: P605Draft | ((d: P605Draft) => P605Draft)) => void;
  p605EditId: string | null; setP605EditId: (v: string | null) => void;
  p624Orders: P624Order[];
  p624ShowForm: boolean; setP624ShowForm: (updater: boolean | ((v: boolean) => boolean)) => void;
  p624Draft: P624Draft; setP624Draft: (updater: P624Draft | ((d: P624Draft) => P624Draft)) => void;
  p637Horizon: '7d' | '30d' | '90d'; setP637Horizon: (v: '7d' | '30d' | '90d') => void;
}

export default function UretimPage({
  currentLanguage, isAuthenticated, canAccess, hasFullAccess, setActiveTab, toast,
  p605Capacity, p605ShowForm, setP605ShowForm, p605Draft, setP605Draft, p605EditId, setP605EditId,
  p624Orders, p624ShowForm, setP624ShowForm, p624Draft, setP624Draft,
  p637Horizon, setP637Horizon,
}: Props) {
  return (
    <motion.div key="production" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
      {!canAccess('production') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage==='tr'?'Üretim Yönetimi':'Production Management'} /> : (
        <>
          {!hasFullAccess('production') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
          {/* ── Üretim Group Nav ── */}
          <div className="overflow-x-auto scrollbar-none">
            <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max">
              <button className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-brand text-white shadow-sm whitespace-nowrap">
                <Factory className="w-3.5 h-3.5" />
                {currentLanguage === 'tr' ? 'Üretim Yönetimi' : 'Production'}
              </button>
              <button onClick={() => setActiveTab('lotseri')} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100 transition-all whitespace-nowrap">
                <Hash className="w-3.5 h-3.5" />
                {currentLanguage === 'tr' ? 'Lot/Seri Takip' : 'Lot/Serial'}
              </button>
              <button onClick={() => setActiveTab('bakim')} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100 transition-all whitespace-nowrap">
                <Wrench className="w-3.5 h-3.5" />
                {currentLanguage === 'tr' ? 'Bakım-Onarım' : 'Maintenance'}
              </button>
            </div>
          </div>
          {/* ── Phase 605: Üretim Kapasitesi Planlama ────────────────────── */}
          {(() => {
            const tr605 = currentLanguage === 'tr';
            const totalUtil = p605Capacity.length > 0
              ? p605Capacity.reduce((s,l)=>s+(l.maxCap>0?(l.planned/l.maxCap)*100:0),0)/p605Capacity.length : 0;
            return (
              <div className="apple-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-gray-900 text-sm">{tr605?'🏭 Üretim Kapasitesi Planlama':'🏭 Production Capacity Planning'}</h3>
                    {p605Capacity.length>0&&<p className="text-xs text-gray-400 mt-0.5">{tr605?'Ort. Kapasite Kullanımı:':'Avg Utilization:'} <span className={`font-bold ${totalUtil>90?'text-red-600':totalUtil>70?'text-amber-600':'text-emerald-600'}`}>{totalUtil.toFixed(0)}%</span></p>}
                  </div>
                  {hasFullAccess('production')&&(<button onClick={()=>setP605ShowForm(v=>!v)} className="apple-button-primary flex items-center gap-2 text-sm"><Plus className="w-4 h-4"/>{tr605?'Hat Ekle':'Add Line'}</button>)}
                </div>
                {p605ShowForm&&(
                  <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <input className="apple-input px-3 py-2 text-sm" placeholder={tr605?'Hat Adı':'Line Name'} value={p605Draft.line} onChange={e=>setP605Draft(d=>({...d,line:e.target.value}))} />
                      <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={tr605?'Max Kapasite':'Max Capacity'} value={p605Draft.maxCap} onChange={e=>setP605Draft(d=>({...d,maxCap:e.target.value}))} />
                      <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={tr605?'Planlanan':'Planned'} value={p605Draft.planned} onChange={e=>setP605Draft(d=>({...d,planned:e.target.value}))} />
                      <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={tr605?'Gerçekleşen':'Actual'} value={p605Draft.actual} onChange={e=>setP605Draft(d=>({...d,actual:e.target.value}))} />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={async ()=>{if(!p605Draft.line) return; try{const payload605={line:p605Draft.line,maxCap:Number(p605Draft.maxCap)||0,planned:Number(p605Draft.planned)||0,actual:Number(p605Draft.actual)||0}; if(p605EditId){ await updateDoc(doc(db,'capacityLines',p605EditId),payload605); setP605EditId(null); } else { await addDoc(collection(db,'capacityLines'),{...payload605,createdAt:serverTimestamp()}); }}catch(e){console.error("[firestore]", e); toast(tr605?'Hat kaydedilemedi (yetki?).':'Save failed.','error');} setP605Draft({line:'',maxCap:'',planned:'',actual:''}); setP605ShowForm(false);}} className="apple-button-primary text-sm px-4 py-1.5">{tr605?'Kaydet':'Save'}</button>
                      <button onClick={()=>setP605ShowForm(false)} className="apple-button-secondary text-sm px-4 py-1.5">{tr605?'İptal':'Cancel'}</button>
                    </div>
                  </div>
                )}
                {p605Capacity.length===0?(
                  <p className="text-center py-6 text-gray-400 text-sm">{tr605?'"Hat Ekle" ile üretim hatlarını ve kapasitelerini tanımlayın.':'Click "Add Line" to define production lines and their capacities.'}</p>
                ):(
                  <div className="space-y-3">
                    {p605Capacity.map((l,i)=>{
                      const planPct = l.maxCap>0?Math.min(100,(l.planned/l.maxCap)*100):0;
                      const actPct = l.maxCap>0?Math.min(100,(l.actual/l.maxCap)*100):0;
                      return (
                        <div key={i} className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-gray-800">{l.line}</span>
                            <div className="flex items-center gap-2">
                            <span className="text-gray-500">{l.actual}/{l.maxCap} {tr605?'birim':'units'} ({actPct.toFixed(0)}%)</span>
                            {l.id&&<button onClick={()=>{setP605Draft({line:l.line,maxCap:String(l.maxCap),planned:String(l.planned),actual:String(l.actual)});setP605EditId(l.id!);setP605ShowForm(true);}} title={tr605?'Düzenle':'Edit'} className="text-gray-300 hover:text-blue-600"><Edit2 className="w-3.5 h-3.5"/></button>}
                            {l.id&&<button onClick={async ()=>{try{await deleteDoc(doc(db,'capacityLines',l.id!));}catch(e){console.error("[firestore]", e); toast(tr605?'Silinemedi (yetki?).':'Delete failed.','error');}}} title={tr605?'Sil':'Delete'} className="text-gray-300 hover:text-red-600"><Trash2 className="w-3.5 h-3.5"/></button>}
                            </div>
                          </div>
                          <div className="relative w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                            <div className="absolute h-full bg-blue-200 rounded-full" style={{width:`${planPct}%`}}/>
                            <div className={`absolute h-full rounded-full ${actPct>90?'bg-red-500':actPct>70?'bg-amber-400':'bg-emerald-400'}`} style={{width:`${actPct}%`}}/>
                          </div>
                          <p className="text-[10px] text-gray-400">{tr605?'Planlanan:':'Planned:'} {planPct.toFixed(0)}% · {tr605?'Gerçekleşen:':'Actual:'} {actPct.toFixed(0)}%</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}
          <ProductionModule currentLanguage={currentLanguage} isAuthenticated={isAuthenticated} />
          {/* ── BOM / MRP ── */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <BOMPanel currentLanguage={currentLanguage} />
          </div>
          {/* ── Phase 624: Üretim Emri Yönetimi ──────────────────────────── */}
          {(() => {
            const tr624 = currentLanguage === 'tr';
            const statusCls:{[k:string]:string}={Planlandı:'bg-gray-100 text-gray-600',Üretimde:'bg-blue-100 text-blue-700',Tamamlandı:'bg-emerald-100 text-emerald-700',İptal:'bg-red-100 text-red-700'};
            const inProd = p624Orders.filter(o=>o.status==='Üretimde').length;
            const urgent = p624Orders.filter(o=>o.priority==='Acil'&&o.status!=='Tamamlandı'&&o.status!=='İptal').length;
            return (
              <div className="apple-card p-5 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="font-bold text-gray-900 text-sm">⚙️ {tr624?'Üretim Emri Yönetimi':'Production Order Management'}</h3>
                  <button onClick={()=>setP624ShowForm(v=>!v)} className="apple-button-secondary text-xs flex items-center gap-1.5"><Plus className="w-3.5 h-3.5"/>{tr624?'Üretim Emri':'New Order'}</button>
                </div>
                {urgent>0&&<div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-xs font-bold text-red-700">🔴 {urgent} {tr624?'acil üretim emri':'urgent production order(s)'}</div>}
                {p624ShowForm && (
                  <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      <input className="apple-input col-span-2 md:col-span-1" placeholder={tr624?'Ürün':'Product'} value={p624Draft.productName} onChange={e=>setP624Draft(d=>({...d,productName:e.target.value}))}/>
                      <input type="number" className="apple-input" placeholder={tr624?'Miktar':'Qty'} value={p624Draft.qty} onChange={e=>setP624Draft(d=>({...d,qty:e.target.value}))}/>
                      <input className="apple-input" placeholder={tr624?'İş Merkezi':'Work Center'} value={p624Draft.workCenter} onChange={e=>setP624Draft(d=>({...d,workCenter:e.target.value}))}/>
                      <input type="date" className="apple-input" value={p624Draft.plannedStart} onChange={e=>setP624Draft(d=>({...d,plannedStart:e.target.value}))}/>
                      <input type="date" className="apple-input" value={p624Draft.plannedEnd} onChange={e=>setP624Draft(d=>({...d,plannedEnd:e.target.value}))}/>
                      <select value={p624Draft.priority} onChange={e=>setP624Draft(d=>({...d,priority:e.target.value as P624Draft['priority']}))} className="apple-input">
                        {['Normal','Acil'].map(p=><option key={p}>{p}</option>)}
                      </select>
                    </div>
                    <button onClick={async ()=>{
                      if(!p624Draft.productName||!p624Draft.qty) return;
                      // Çift toast düzeltildi (2026-08-31): başarı bildirimi hem try
                      // içinde hem sonrasında koşulsuz atılıyordu — teke indi.
                      try { await addDoc(collection(db,'productionOrders'),{productName:p624Draft.productName,qty:Number(p624Draft.qty),plannedStart:p624Draft.plannedStart,plannedEnd:p624Draft.plannedEnd,status:'Planlandı',priority:p624Draft.priority,workCenter:p624Draft.workCenter,createdAt:serverTimestamp()}); toast(tr624 ? 'Üretim emri oluşturuldu ✓' : 'Production order created ✓', 'success'); } catch(e){console.error("[firestore]", e); toast(tr624 ? 'Üretim emri oluşturulamadı.' : 'Failed to create order.', 'error');}
                      setP624Draft(d=>({...d,productName:'',qty:'',workCenter:'',plannedStart:'',plannedEnd:''}));
                      setP624ShowForm(false);
                    }} className="apple-button-primary text-xs px-6">{tr624?'Oluştur':'Create'}</button>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-blue-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr624?'Üretimde':'In Prod.'}</p><p className="text-xl font-black text-blue-600">{inProd}</p></div>
                  <div className="bg-amber-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr624?'Planlandı':'Planned'}</p><p className="text-xl font-black text-amber-600">{p624Orders.filter(o=>o.status==='Planlandı').length}</p></div>
                  <div className="bg-emerald-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr624?'Tamamlanan':'Done'}</p><p className="text-xl font-black text-emerald-600">{p624Orders.filter(o=>o.status==='Tamamlandı').length}</p></div>
                </div>
                {p624Orders.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-[560px]">
                      <thead><tr className="border-b border-gray-100 bg-gray-50">
                        {[tr624?'Ürün':'Product',tr624?'Miktar':'Qty',tr624?'İş Merkezi':'Work Center',tr624?'Başlangıç':'Start',tr624?'Bitiş':'End',tr624?'Durum':'Status',tr624?'Öncelik':'Priority'].map(h=>(
                          <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                        ))}
                      </tr></thead>
                      <tbody className="divide-y divide-gray-50">
                        {[...p624Orders].sort((a,b)=>a.plannedStart.localeCompare(b.plannedStart)).map(o=>(
                          <tr key={o.id} className={`hover:bg-gray-50/50 ${o.priority==='Acil'?'bg-red-50/20':''}`}>
                            <td className="px-3 py-2.5 font-medium text-gray-800">{o.productName}</td>
                            <td className="px-3 py-2.5 text-gray-600">{o.qty}</td>
                            <td className="px-3 py-2.5 text-gray-500">{o.workCenter||'—'}</td>
                            <td className="px-3 py-2.5 text-gray-500">{o.plannedStart?new Date(o.plannedStart).toLocaleDateString('tr-TR'):'—'}</td>
                            <td className="px-3 py-2.5 text-gray-500">{o.plannedEnd?new Date(o.plannedEnd).toLocaleDateString('tr-TR'):'—'}</td>
                            <td className="px-3 py-2.5">
                              <select value={o.status} onChange={async e=>{try{await updateDoc(doc(db,'productionOrders',o.id),{status:e.target.value});}catch(err){console.error(err); toast(tr624?'Durum güncellenemedi (yetki?).':'Status update failed.','error');}}} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border-0 ${statusCls[o.status]}`}>
                                {['Planlandı','Üretimde','Tamamlandı','İptal'].map(s=><option key={s}>{s}</option>)}
                              </select>
                            </td>
                            <td className="px-3 py-2.5"><span className={`text-[10px] font-bold ${o.priority==='Acil'?'text-red-600':'text-gray-400'}`}>{o.priority}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {p624Orders.length===0&&<p className="text-center text-gray-400 text-xs py-4">{tr624?'Üretim emri ekleyin.':'Create production orders to track manufacturing.'}</p>}
              </div>
            );
          })()}

          {/* ── Phase 637: Kapasite Planlama ──────────────────────────────── */}
          {(() => {
            const tr637 = currentLanguage === 'tr';
            const horizonDays = p637Horizon==='7d'?7:p637Horizon==='30d'?30:90;
            const cutoff637 = new Date(Date.now()+horizonDays*86400000).toISOString().slice(0,10);
            const upcoming637 = p624Orders.filter(o=>o.status!=='Tamamlandı'&&o.status!=='İptal'&&o.plannedEnd&&o.plannedEnd<=cutoff637);
            const workCenterLoad:{[wc:string]:{orders:number;totalQty:number}} = {};
            upcoming637.forEach(o=>{
              // Öncelik hatası düzeltildi (2026-08-31): `a || tr ? x : y` = `(a||tr) ? x : y`
              // olduğundan GERÇEK iş merkezi adları hiç kullanılmıyor, her emir
              // 'Genel Hat' kovasına düşüyordu.
              const wc = o.workCenter || (tr637 ? 'Genel Hat' : 'General Line');
              if(!workCenterLoad[wc]) workCenterLoad[wc]={orders:0,totalQty:0};
              workCenterLoad[wc].orders++;
              workCenterLoad[wc].totalQty += o.qty||0;
            });
            const wcRows = Object.entries(workCenterLoad).map(([wc,d])=>({wc,...d})).sort((a,b)=>b.totalQty-a.totalQty);
            const maxQty = wcRows.length>0?Math.max(...wcRows.map(r=>r.totalQty),1):1;
            return (
              <div className="apple-card p-5 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div><h3 className="font-bold text-gray-900 text-sm">🏭 {tr637?'Kapasite Planlama':'Capacity Planning'}</h3>
                  <p className="text-xs text-gray-400">{tr637?'İş merkezi bazında yük dağılımı':'Workload distribution by work center'}</p></div>
                  <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                    {([{k:'7d',l:'7G'},{k:'30d',l:'30G'},{k:'90d',l:'90G'}] as {k:'7d'|'30d'|'90d';l:string}[]).map(t=>(
                      <button key={t.k} onClick={()=>setP637Horizon(t.k)} className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${p637Horizon===t.k?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>{t.l}</button>
                    ))}
                  </div>
                </div>
                {wcRows.length > 0 ? (
                  <div className="space-y-3">
                    {wcRows.map(r=>{
                      const pct = maxQty>0?(r.totalQty/maxQty)*100:0;
                      const overloaded = pct > 80;
                      return (
                        <div key={r.wc}>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="font-semibold text-gray-800">{r.wc}</span>
                            <span className="text-gray-500">{r.orders} {tr637?'emir':'orders'} · {r.totalQty} {tr637?'birim':'units'}</span>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${overloaded?'bg-red-500':pct>50?'bg-amber-400':'bg-emerald-400'}`} style={{width:`${pct}%`}} />
                          </div>
                          {overloaded&&<p className="text-[10px] text-red-500 mt-0.5">⚠️ {tr637?'Yüksek yük — kapasite aşımı riski':'High load — capacity overrun risk'}</p>}
                        </div>
                      );
                    })}
                  </div>
                ) : <p className="text-center text-gray-400 text-xs py-4">{tr637?`Önümüzdeki ${horizonDays} gün içinde planlanmış üretim emri yok.`:`No production orders planned in the next ${horizonDays} days.`}</p>}
                <div className="grid grid-cols-3 gap-3 border-t border-gray-100 pt-3">
                  <div className="bg-blue-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr637?'Bekleyen Emir':'Pending Orders'}</p><p className="text-xl font-black text-blue-600">{upcoming637.length}</p></div>
                  <div className="bg-amber-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr637?'İş Merkezi':'Work Centers'}</p><p className="text-xl font-black text-amber-600">{wcRows.length}</p></div>
                  <div className="bg-emerald-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr637?'Toplam Birim':'Total Units'}</p><p className="text-xl font-black text-emerald-600">{wcRows.reduce((s,r)=>s+r.totalQty,0)}</p></div>
                </div>
              </div>
            );
          })()}
        </>
      )}
    </motion.div>
  );
}
