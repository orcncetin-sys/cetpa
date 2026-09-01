/**
 * KalitePage — Kalite Yönetimi sekmesi.
 *
 * App.tsx'ten ÇIKARILDI (2026-08-31, App.tsx bölme hattı — kalite bloğu ~145
 * satırdı). Davranış birebir taşındı; çeklist yazmalarındaki sessiz-başarısızlık
 * toast'ları aynı gün eklenmişti, blokla birlikte geldi.
 */
import { motion } from 'motion/react';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { db } from '../firebase';
import { doc, collection, addDoc, updateDoc, deleteDoc, serverTimestamp } from '../lib/dbClient';
import UnauthorizedView from '../components/UnauthorizedView';
import ReadOnlyBanner from '../components/ReadOnlyBanner';
import QualityModule from '../components/QualityModule';

export interface P587Check { id: string; item: string; checked: boolean; severity: 'Kritik' | 'Uyarı' | 'Bilgi'; }
export interface P615Metric { id: string; date: string; line: string; total: number; defects: number; rework: number; }
export interface P615Draft { date: string; line: string; total: string; defects: string; rework: string; }

interface Props {
  currentLanguage: 'tr' | 'en';
  isModuleAuthenticated: boolean;
  canAccess: (tab: string) => boolean;
  hasFullAccess: (tab: string) => boolean;
  toast: (msg: string, tur?: 'success' | 'error' | 'info') => void;
  p587Checks: P587Check[];
  p587NewItem: string; setP587NewItem: (v: string) => void;
  qualityActiveTab: string; setQualityActiveTab: (v: string) => void;
  p615Metrics: P615Metric[];
  p615ShowForm: boolean; setP615ShowForm: (v: boolean) => void;
  p615Draft: P615Draft; setP615Draft: (u: P615Draft | ((d: P615Draft) => P615Draft)) => void;
  p615EditId: string | null; setP615EditId: (v: string | null) => void;
}

export default function KalitePage({
  currentLanguage, isModuleAuthenticated, canAccess, hasFullAccess, toast,
  p587Checks, p587NewItem, setP587NewItem, qualityActiveTab, setQualityActiveTab,
  p615Metrics, p615ShowForm, setP615ShowForm, p615Draft, setP615Draft, p615EditId, setP615EditId,
}: Props) {
  return (
    <motion.div key="kalite" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
      {!canAccess('kalite') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage==='tr'?'Kalite Yönetimi':'Quality Management'} /> : (
        <>
          {!hasFullAccess('kalite') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
          {/* ── Phase 587: Kalite Kontrol Çeklisti ─────────────────────── */}
          {(() => {
            const tr587 = currentLanguage === 'tr';
            const sevColors: Record<string,string> = {'Kritik':'text-red-600','Uyarı':'text-amber-600','Bilgi':'text-blue-600'};
            const criticalFailed = p587Checks.filter(c=>c.severity==='Kritik'&&!c.checked).length;
            return (
              <div className="apple-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-gray-900 text-sm">{tr587?'✅ Kalite Kontrol Çeklisti':'✅ Quality Inspection Checklist'}</h3>
                    {criticalFailed>0&&<p className="text-xs text-red-600 font-semibold mt-0.5">⚠️ {criticalFailed} {tr587?'kritik madde tamamlanmadı':'critical item(s) incomplete'}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-emerald-600">{p587Checks.filter(c=>c.checked).length}/{p587Checks.length}</span>
                  </div>
                </div>
                {p587Checks.length>0 && (
                  <div className="w-full bg-gray-200 rounded-full h-2 mb-4 overflow-hidden">
                    <div className="h-full bg-emerald-400 rounded-full transition-all" style={{width:`${p587Checks.length>0?(p587Checks.filter(c=>c.checked).length/p587Checks.length)*100:0}%`}}/>
                  </div>
                )}
                <div className="space-y-2 mb-4">
                  {p587Checks.map(c=>(
                    <div key={c.id} className={`flex items-center gap-3 p-3 rounded-xl ${c.checked?'bg-green-50/50':'bg-gray-50'}`}>
                      {/* Sessiz-başarısızlık taraması (2026-08-31): çeklist yazmaları
                          RBAC 403'te sessizce yutuluyordu — toast eklendi (4 nokta). */}
                      <button onClick={()=>{void updateDoc(doc(db,'qualityChecklist',c.id),{checked:!c.checked}).catch(()=>toast(tr587?'Kaydedilemedi (yetki?).':'Save failed.','error'));}} className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${c.checked?'bg-emerald-500 border-emerald-500':'border-gray-300'}`}>
                        {c.checked&&<svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>}
                      </button>
                      <span className={`flex-1 text-sm ${c.checked?'line-through text-gray-400':'text-gray-700'}`}>{c.item}</span>
                      <span className={`text-[10px] font-bold shrink-0 ${sevColors[c.severity]}`}>{c.severity}</span>
                      <button onClick={()=>{void deleteDoc(doc(db,'qualityChecklist',c.id)).catch(()=>toast(tr587?'Silinemedi (yetki?).':'Delete failed.','error'));}} className="text-gray-300 hover:text-red-400 shrink-0">✕</button>
                    </div>
                  ))}
                </div>
                {hasFullAccess('kalite') && (
                  <div className="flex gap-2">
                    <input className="flex-1 apple-input px-3 py-2 text-sm" placeholder={tr587?'Yeni kontrol maddesi...':'New check item...'} value={p587NewItem} onChange={e=>setP587NewItem(e.target.value)} onKeyDown={e=>{
                      if(e.key==='Enter'&&p587NewItem.trim()){
                        void addDoc(collection(db,'qualityChecklist'),{item:p587NewItem.trim(),checked:false,severity:'Bilgi',createdAt:serverTimestamp()}).catch(()=>toast(tr587?'Madde eklenemedi (yetki?).':'Add failed.','error'));
                        setP587NewItem('');
                      }
                    }} />
                    <button onClick={()=>{
                      if(!p587NewItem.trim()) return;
                      void addDoc(collection(db,'qualityChecklist'),{item:p587NewItem.trim(),checked:false,severity:'Bilgi',createdAt:serverTimestamp()}).catch(()=>toast(tr587?'Madde eklenemedi (yetki?).':'Add failed.','error'));
                      setP587NewItem('');
                    }} className="apple-button-primary px-3 py-2 text-sm">{tr587?'Ekle':'Add'}</button>
                    {p587Checks.length>0&&(
                      <button onClick={()=>{p587Checks.filter(c=>!c.checked).forEach(c=>{void updateDoc(doc(db,'qualityChecklist',c.id),{checked:true}).catch(()=>toast(tr587?'Kaydedilemedi (yetki?).':'Save failed.','error'));});}} className="apple-button-secondary px-3 py-2 text-xs">{tr587?'Tümünü İşaretle':'Check All'}</button>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
          <QualityModule currentLanguage={currentLanguage} isAuthenticated={isModuleAuthenticated} onTabChange={setQualityActiveTab} />

          {/* ── Phase 615: Üretim Kalite Metrikleri (yalnız KPI sekmesinde) ── */}
          {hasFullAccess('kalite') && qualityActiveTab === 'kpi' && (() => {
            const tr615 = currentLanguage === 'tr';
            const totalProduced = p615Metrics.reduce((s,m)=>s+m.total,0);
            const totalDefects  = p615Metrics.reduce((s,m)=>s+m.defects,0);
            const totalRework   = p615Metrics.reduce((s,m)=>s+m.rework,0);
            const defectRate = totalProduced>0?(totalDefects/totalProduced*100):0;
            const firstPassYield = totalProduced>0?((totalProduced-totalDefects-totalRework)/totalProduced*100):0;
            return (
              <div className="apple-card p-5 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="font-bold text-gray-900 text-sm">📊 {tr615?'Üretim Kalite Metrikleri':'Production Quality Metrics'}</h3>
                  <button onClick={()=>{if(p615ShowForm){setP615ShowForm(false);setP615EditId(null);}else{setP615EditId(null);setP615Draft({date:new Date().toISOString().slice(0,10),line:'',total:'',defects:'',rework:''});setP615ShowForm(true);}}} className="apple-button-secondary text-xs flex items-center gap-1.5"><Plus className="w-3.5 h-3.5"/>{tr615?'Kayıt Ekle':'Add Record'}</button>
                </div>
                {p615ShowForm && (
                  <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                      <input type="date" className="apple-input" value={p615Draft.date} onChange={e=>setP615Draft(d=>({...d,date:e.target.value}))}/>
                      <input className="apple-input" placeholder={tr615?'Hat':'Line'} value={p615Draft.line} onChange={e=>setP615Draft(d=>({...d,line:e.target.value}))}/>
                      <input type="number" className="apple-input" placeholder={tr615?'Toplam':'Total'} value={p615Draft.total} onChange={e=>setP615Draft(d=>({...d,total:e.target.value}))}/>
                      <input type="number" className="apple-input" placeholder={tr615?'Hatalı':'Defects'} value={p615Draft.defects} onChange={e=>setP615Draft(d=>({...d,defects:e.target.value}))}/>
                      <input type="number" className="apple-input" placeholder={tr615?'Yeniden İşlem':'Rework'} value={p615Draft.rework} onChange={e=>setP615Draft(d=>({...d,rework:e.target.value}))}/>
                    </div>
                    <button onClick={async ()=>{
                      if(!p615Draft.line||!p615Draft.total) return;
                      const payload={date:p615Draft.date,line:p615Draft.line,total:Number(p615Draft.total),defects:Number(p615Draft.defects)||0,rework:Number(p615Draft.rework)||0};
                      try {
                        if(p615EditId){ await updateDoc(doc(db,'productionMetrics',p615EditId),payload); }
                        else { await addDoc(collection(db,'productionMetrics'),payload); }
                        setP615Draft(d=>({...d,line:'',total:'',defects:'',rework:''}));
                        setP615ShowForm(false); setP615EditId(null);
                        toast(tr615?(p615EditId?'Kayıt güncellendi.':'Kayıt eklendi.'):(p615EditId?'Record updated.':'Record added.'),'success');
                      } catch(e){ toast((tr615?'Kaydedilemedi: ':'Save failed: ')+(e instanceof Error?e.message:String(e)),'error'); }
                    }} className="apple-button-primary text-xs px-6">{tr615?'Kaydet':'Save'}</button>
                  </div>
                )}
                {p615Metrics.length > 0 && (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-blue-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr615?'Toplam Üretim':'Total Produced'}</p><p className="text-xl font-black text-blue-600">{totalProduced.toLocaleString()}</p></div>
                      <div className="bg-red-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr615?'Hata Oranı':'Defect Rate'}</p><p className="text-xl font-black text-red-600">%{defectRate.toFixed(2)}</p></div>
                      <div className="bg-emerald-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr615?'İlk Geçiş Verimi':'First Pass Yield'}</p><p className="text-xl font-black text-emerald-600">%{firstPassYield.toFixed(1)}</p></div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs min-w-[560px]">
                        <thead><tr className="border-b border-gray-100 bg-gray-50">
                          {[tr615?'Tarih':'Date',tr615?'Hat':'Line',tr615?'Toplam':'Total',tr615?'Hatalı':'Defects',tr615?'Yeniden İşlem':'Rework',tr615?'Hata %':'Defect %'].map(h=>(
                            <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                          ))}
                          <th className="px-3 py-2 w-8"></th>
                        </tr></thead>
                        <tbody className="divide-y divide-gray-50">
                          {[...p615Metrics].sort((a,b)=>b.date.localeCompare(a.date)).map(m=>{
                            const dr = m.total>0?(m.defects/m.total*100):0;
                            return (
                              <tr key={m.id} className="hover:bg-gray-50/50">
                                <td className="px-3 py-2 text-gray-500">{new Date(m.date).toLocaleDateString('tr-TR')}</td>
                                <td className="px-3 py-2 font-medium text-gray-800">{m.line}</td>
                                <td className="px-3 py-2 tabular-nums text-gray-600">{m.total}</td>
                                <td className="px-3 py-2 tabular-nums text-red-600 font-bold">{m.defects}</td>
                                <td className="px-3 py-2 tabular-nums text-amber-600">{m.rework}</td>
                                <td className={`px-3 py-2 font-bold ${dr>5?'text-red-600':dr>2?'text-amber-600':'text-emerald-600'}`}>%{dr.toFixed(2)}</td>
                                <td className="px-3 py-2 text-right"><div className="flex items-center justify-end gap-2">
                                  <button type="button" onClick={()=>{setP615Draft({date:m.date,line:m.line,total:String(m.total),defects:String(m.defects),rework:String(m.rework)});setP615EditId(m.id);setP615ShowForm(true);}} title={tr615?'Düzenle':'Edit'} className="text-gray-300 hover:text-blue-600 transition-colors"><Edit2 className="w-3.5 h-3.5"/></button>
                                  <button type="button" onClick={async ()=>{try{await deleteDoc(doc(db,'productionMetrics',m.id));}catch(e){toast((tr615?'Silinemedi: ':'Delete failed: ')+(e instanceof Error?e.message:String(e)),'error');}}} title={tr615?'Sil':'Delete'} className="text-gray-300 hover:text-red-600 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>
                                </div></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                {p615Metrics.length === 0 && <p className="text-center text-gray-400 text-xs py-4">{tr615?'Üretim kalite verisi ekleyin.':'Add production quality records.'}</p>}
              </div>
            );
          })()}
        </>
      )}
    </motion.div>
  );
}
