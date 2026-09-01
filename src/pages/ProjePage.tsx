/**
 * ProjePage — Proje Yönetimi sekmesi.
 *
 * App.tsx'ten ÇIKARILDI (2026-08-31, App.tsx bölme hattı — proje bloğu ~155
 * satırdı). Davranış birebir; İKİ KÜÇÜK DÜZELTME dışında:
 *   1. Zaman çizelgesi kaydetmede başarı toast'ı İKİ KEZ atılıyordu (try
 *      içinde + ardından koşulsuz) — teke indirildi.
 *   2. Sessiz-başarısızlık sınıfı: silme/ilerleme güncelleme catch'leri yalnız
 *      console'a yazıyordu — kullanıcıya toast eklendi (bugünkü taramanın devamı).
 */
import { motion } from 'motion/react';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { db } from '../firebase';
import { doc, collection, addDoc, updateDoc, deleteDoc, serverTimestamp } from '../lib/dbClient';
import UnauthorizedView from '../components/UnauthorizedView';
import ReadOnlyBanner from '../components/ReadOnlyBanner';
import ProjectModule from '../components/ProjectModule';
import { confirmDelete } from '../lib/confirm';

export interface P582Project { id: string; name: string; budget: number; spent: number; status: 'Aktif' | 'Tamamlandı' | 'Beklemede'; }
export interface P582Draft { name: string; budget: string; spent: string; status: P582Project['status']; }
export interface P618Project { id: string; name: string; start: string; end: string; progress: number; status: 'Aktif' | 'Beklemede' | 'Gecikmiş' | 'Tamamlandı'; owner: string; }
export interface P618Draft { name: string; start: string; end: string; progress: string; status: P618Project['status']; owner: string; }

interface Props {
  currentLanguage: 'tr' | 'en';
  isModuleAuthenticated: boolean;
  userRole?: string | null;
  canAccess: (tab: string) => boolean;
  hasFullAccess: (tab: string) => boolean;
  toast: (msg: string, tur?: 'success' | 'error' | 'info') => void;
  p582Projects: P582Project[];
  p582ShowForm: boolean; setP582ShowForm: (u: boolean | ((v: boolean) => boolean)) => void;
  p582Draft: P582Draft; setP582Draft: (u: P582Draft | ((d: P582Draft) => P582Draft)) => void;
  p582EditId: string | null; setP582EditId: (v: string | null) => void;
  p618Projects: P618Project[];
  p618ShowForm: boolean; setP618ShowForm: (u: boolean | ((v: boolean) => boolean)) => void;
  p618Draft: P618Draft; setP618Draft: (u: P618Draft | ((d: P618Draft) => P618Draft)) => void;
  p618EditId: string | null; setP618EditId: (v: string | null) => void;
}

export default function ProjePage({
  currentLanguage, isModuleAuthenticated, userRole, canAccess, hasFullAccess, toast,
  p582Projects, p582ShowForm, setP582ShowForm, p582Draft, setP582Draft, p582EditId, setP582EditId,
  p618Projects, p618ShowForm, setP618ShowForm, p618Draft, setP618Draft, p618EditId, setP618EditId,
}: Props) {
  return (
    <motion.div key="proje" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
      {!canAccess('proje') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage==='tr'?'Proje Yönetimi':'Project Management'} /> : (
        <>
          {!hasFullAccess('proje') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
          {/* ── Phase 582: Proje Maliyet Takibi ─────────────────────────── */}
          {(() => {
            const tr582 = currentLanguage === 'tr';
            const statusColors582: Record<string,string> = {'Aktif':'bg-green-100 text-green-700','Tamamlandı':'bg-blue-100 text-blue-700','Beklemede':'bg-gray-100 text-gray-500'};
            return (
              <div className="apple-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-900 text-sm">{tr582?'💼 Proje Maliyet Takibi':'💼 Project Cost Tracking'}</h3>
                  {hasFullAccess('proje') && (
                    <button onClick={()=>setP582ShowForm(v=>!v)} className="apple-button-primary flex items-center gap-2 text-sm">
                      <Plus className="w-4 h-4"/>{tr582?'Proje Ekle':'Add Project'}
                    </button>
                  )}
                </div>
                {p582ShowForm && (
                  <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <input className="apple-input px-3 py-2 text-sm col-span-2" placeholder={tr582?'Proje Adı':'Project Name'} value={p582Draft.name} onChange={e=>setP582Draft(d=>({...d,name:e.target.value}))} />
                      <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={tr582?'Bütçe (₺)':'Budget (₺)'} value={p582Draft.budget} onChange={e=>setP582Draft(d=>({...d,budget:e.target.value}))} />
                      <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={tr582?'Harcanan (₺)':'Spent (₺)'} value={p582Draft.spent} onChange={e=>setP582Draft(d=>({...d,spent:e.target.value}))} />
                      <select className="apple-input px-3 py-2 text-sm" value={p582Draft.status} onChange={e=>setP582Draft(d=>({...d,status:e.target.value as P582Draft['status']}))}>
                        <option value="Aktif">{tr582?'Aktif':'Active'}</option>
                        <option value="Tamamlandı">{tr582?'Tamamlandı':'Completed'}</option>
                        <option value="Beklemede">{tr582?'Beklemede':'On Hold'}</option>
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={async ()=>{
                        if(!p582Draft.name) return;
                        try { const payload582={name:p582Draft.name,budget:Number(p582Draft.budget)||0,spent:Number(p582Draft.spent)||0,status:p582Draft.status}; if(p582EditId){ await updateDoc(doc(db,'projectCosts',p582EditId),payload582); setP582EditId(null); } else { await addDoc(collection(db,'projectCosts'),{...payload582,createdAt:serverTimestamp()}); } toast(tr582 ? 'Proje maliyeti eklendi ✓' : 'Project cost added ✓', 'success'); } catch(e){console.error("[firestore]", e); toast(tr582 ? 'Maliyet eklenemedi.' : 'Failed to add cost.', 'error');}
                        setP582Draft({name:'',budget:'',spent:'',status:'Aktif'});
                        setP582ShowForm(false);
                      }} className="apple-button-primary text-sm px-4 py-1.5">{tr582?'Kaydet':'Save'}</button>
                      <button onClick={()=>setP582ShowForm(false)} className="apple-button-secondary text-sm px-4 py-1.5">{tr582?'İptal':'Cancel'}</button>
                    </div>
                  </div>
                )}
                {p582Projects.length === 0 ? (
                  <p className="text-center py-8 text-gray-400 text-sm">{tr582?'"Proje Ekle" ile bütçe takibi başlatın.':'Click "Add Project" to start tracking project costs.'}</p>
                ) : (
                  <div className="space-y-3">
                    {p582Projects.map(p=>{
                      const pct = p.budget>0?Math.min(100,(p.spent/p.budget)*100):0;
                      const isOver = p.spent>p.budget && p.budget>0;
                      return (
                        <div key={p.id} className={`p-4 rounded-xl border ${isOver?'border-red-200 bg-red-50/20':'border-gray-100'}`}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <p className="font-semibold text-gray-800">{p.name}</p>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusColors582[p.status]}`}>{p.status}</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                              <span className={`font-bold ${isOver?'text-red-600':'text-gray-700'}`}>₺{p.spent.toLocaleString()} / ₺{p.budget.toLocaleString()}</span>
                              <button onClick={()=>{setP582Draft({name:p.name,budget:String(p.budget),spent:String(p.spent),status:p.status});setP582EditId(p.id);setP582ShowForm(true);}} title={tr582?'Düzenle':'Edit'} className="text-gray-300 hover:text-blue-600 ml-2"><Edit2 className="w-3.5 h-3.5"/></button>
                              <button onClick={async ()=>{if(!await confirmDelete(undefined, currentLanguage==='tr'?'tr':'en'))return;try{await deleteDoc(doc(db,'projectCosts',p.id));}catch(e){console.error("[firestore]", e); toast(tr582?'Silinemedi (yetki?).':'Delete failed.','error');}}} className="text-red-400 hover:text-red-600 ml-2">✕</button>
                            </div>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${isOver?'bg-red-500':pct>80?'bg-amber-500':'bg-emerald-400'}`} style={{width:`${pct}%`}} />
                          </div>
                          <p className="text-xs text-gray-400 mt-1">{pct.toFixed(0)}% {tr582?'harcandı':'spent'}{isOver?` • ⚠️ ${tr582?'Bütçe aşıldı!':'Over budget!'}`:''}</p>
                        </div>
                      );
                    })}
                    <div className="border-t border-gray-100 pt-3 flex justify-between text-xs font-semibold text-gray-600">
                      <span>{tr582?'Toplam Bütçe:':'Total Budget:'} ₺{p582Projects.reduce((s,p)=>s+p.budget,0).toLocaleString()}</span>
                      <span>{tr582?'Toplam Harcama:':'Total Spent:'} ₺{p582Projects.reduce((s,p)=>s+p.spent,0).toLocaleString()}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          <ProjectModule currentLanguage={currentLanguage} isAuthenticated={isModuleAuthenticated} userRole={userRole ?? undefined} />

          {/* ── Phase 618: Proje Zaman Çizelgesi (Gantt-lite) ───────────── */}
          {(() => {
            const tr618 = currentLanguage === 'tr';
            const today618 = new Date().toISOString().slice(0,10);
            const overdue618 = p618Projects.filter(p=>p.end<today618&&p.status!=='Tamamlandı').length;
            return (
              <div className="apple-card p-5 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="font-bold text-gray-900 text-sm">📐 {tr618?'Proje Zaman Çizelgesi':'Project Timeline'}</h3>
                  <button onClick={()=>setP618ShowForm(v=>!v)} className="apple-button-secondary text-xs flex items-center gap-1.5"><Plus className="w-3.5 h-3.5"/>{tr618?'Proje Ekle':'Add Project'}</button>
                </div>
                {overdue618>0&&<div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-xs font-semibold text-red-700">⚠️ {overdue618} {tr618?'proje gecikmiş':'project(s) overdue'}</div>}
                {p618ShowForm && (
                  <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      <input className="apple-input col-span-2 md:col-span-1" placeholder={tr618?'Proje adı':'Project name'} value={p618Draft.name} onChange={e=>setP618Draft(d=>({...d,name:e.target.value}))}/>
                      <input className="apple-input" placeholder={tr618?'Sorumlu':'Owner'} value={p618Draft.owner} onChange={e=>setP618Draft(d=>({...d,owner:e.target.value}))}/>
                      <select value={p618Draft.status} onChange={e=>setP618Draft(d=>({...d,status:e.target.value as P618Draft['status']}))} className="apple-input">
                        {['Aktif','Beklemede','Gecikmiş','Tamamlandı'].map(s=><option key={s}>{s}</option>)}
                      </select>
                      <input type="date" className="apple-input" value={p618Draft.start} onChange={e=>setP618Draft(d=>({...d,start:e.target.value}))}/>
                      <input type="date" className="apple-input" value={p618Draft.end} onChange={e=>setP618Draft(d=>({...d,end:e.target.value}))}/>
                      <input type="number" min="0" max="100" className="apple-input" placeholder="% İlerleme" value={p618Draft.progress} onChange={e=>setP618Draft(d=>({...d,progress:e.target.value}))}/>
                    </div>
                    <button onClick={async ()=>{
                      if(!p618Draft.name||!p618Draft.start||!p618Draft.end) return;
                      // Çift toast düzeltildi (2026-08-31): başarı bildirimi hem try
                      // içinde hem sonrasında koşulsuz atılıyordu — teke indi.
                      try { const payload618={name:p618Draft.name,start:p618Draft.start,end:p618Draft.end,progress:Number(p618Draft.progress)||0,status:p618Draft.status,owner:p618Draft.owner}; if(p618EditId){ await updateDoc(doc(db,'projectTimelines',p618EditId),payload618); setP618EditId(null); } else { await addDoc(collection(db,'projectTimelines'),{...payload618,createdAt:serverTimestamp()}); } toast(tr618 ? 'Zaman çizelgesi eklendi ✓' : 'Timeline added ✓', 'success'); } catch(e){console.error("[firestore]", e); toast(tr618 ? 'Zaman çizelgesi eklenemedi.' : 'Failed to add timeline.', 'error');}
                      setP618Draft({name:'',start:'',end:'',progress:'0',status:'Aktif',owner:''});
                      setP618ShowForm(false);
                    }} className="apple-button-primary text-xs px-6">{tr618?'Kaydet':'Save'}</button>
                  </div>
                )}
                {p618Projects.length > 0 && (
                  <div className="space-y-3">
                    {[...p618Projects].sort((a,b)=>a.start.localeCompare(b.start)).map(p=>{
                      const statusCls:{[k:string]:string} = {Aktif:'text-blue-600 bg-blue-50',Tamamlandı:'text-emerald-600 bg-emerald-50',Gecikmiş:'text-red-600 bg-red-50',Beklemede:'text-gray-500 bg-gray-100'};
                      const cls = statusCls[p.status]||'text-gray-500 bg-gray-100';
                      const isLate = p.end<today618&&p.status!=='Tamamlandı';
                      return (
                        <div key={p.id} className={`border rounded-xl px-4 py-3 ${isLate?'border-red-200 bg-red-50/20':'border-gray-100'}`}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <p className="font-semibold text-gray-800 text-sm truncate">{p.name}</p>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${cls}`}>{p.status}</span>
                            </div>
                            <div className="flex items-center gap-3 shrink-0 text-xs text-gray-400">
                              <span>{p.owner}</span>
                              <input type="range" min="0" max="100" value={p.progress} onChange={async e=>{try{await updateDoc(doc(db,'projectTimelines',p.id),{progress:Number(e.target.value)});}catch(err){console.error(err); toast(tr618?'İlerleme kaydedilemedi.':'Progress save failed.','error');}}} className="w-20"/>
                              <span className="font-bold text-gray-700 w-8 text-right">%{p.progress}</span>
                              <button onClick={()=>{setP618Draft({name:p.name,start:p.start,end:p.end,progress:String(p.progress),status:p.status,owner:p.owner});setP618EditId(p.id);setP618ShowForm(true);}} title={tr618?'Düzenle':'Edit'} className="text-gray-300 hover:text-blue-600"><Edit2 className="w-3.5 h-3.5"/></button>
                              <button onClick={async ()=>{try{await deleteDoc(doc(db,'projectTimelines',p.id));}catch(e){console.error("[firestore]", e); toast(tr618?'Silinemedi (yetki?).':'Delete failed.','error');}}} title={tr618?'Sil':'Delete'} className="text-gray-300 hover:text-red-600"><Trash2 className="w-3.5 h-3.5"/></button>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-gray-400 mb-2">
                            <span>{new Date(p.start).toLocaleDateString('tr-TR')}</span>
                            <span>→</span>
                            <span className={isLate?'text-red-500 font-bold':''}>{new Date(p.end).toLocaleDateString('tr-TR')}</span>
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${p.status==='Tamamlandı'?'bg-emerald-400':isLate?'bg-red-400':'bg-blue-400'}`} style={{width:`${p.progress}%`}}/>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {p618Projects.length===0&&<p className="text-center text-gray-400 text-xs py-4">{tr618?'Zaman çizelgesi için proje ekleyin.':'Add projects to track on the timeline.'}</p>}
              </div>
            );
          })()}
        </>
      )}
    </motion.div>
  );
}
