/**
 * MesaiPage — Mesai & Devam Takibi sekmesi (Phase 552: Time & Attendance).
 *
 * App.tsx'ten ÇIKARILDI (2026-09-03, App.tsx bölme hattı — mesai bloğu ~107
 * satırdı). Davranış birebir taşındı: gövde bayt-bayt kesildi, yalnız girinti
 * tekdüze azaltıldı (UretimPage/ProjePage/KalitePage ile aynı desen).
 */
import React from 'react';
import { motion } from 'motion/react';
import { Clock, Plus } from 'lucide-react';
import { db } from '../firebase';
import { collection, addDoc, serverTimestamp } from '../lib/dbClient';
import ModuleHeader from '../components/ModuleHeader';

/** IKPage.tsx'teki AttendanceRecord ile birebir aynı tanım (App'in timeAttendance kaydı). */
export interface AttendanceRecord { id: string; employeeName: string; employeeId?: string; date: string; checkIn: string; checkOut: string; totalHours: number; status: 'Normal' | 'Geç Giriş' | 'Erken Çıkış' | 'Devamsız' | 'İzinli' }
/** App.tsx'teki p552Draft useState başlangıcıyla birebir aynı şekil. */
export interface P552Draft { employeeName: string; date: string; checkIn: string; checkOut: string }

interface Props {
  currentLanguage: 'tr' | 'en';
  hasFullAccess: (tab: string) => boolean;
  p552Records: AttendanceRecord[];
  p552AddForm: boolean;
  setP552AddForm: React.Dispatch<React.SetStateAction<boolean>>;
  p552Draft: P552Draft;
  setP552Draft: React.Dispatch<React.SetStateAction<P552Draft>>;
}

export default function MesaiPage({
  currentLanguage, hasFullAccess, p552Records,
  p552AddForm, setP552AddForm, p552Draft, setP552Draft,
}: Props) {
  const tr552 = currentLanguage === 'tr';
  const today552 = new Date().toISOString().slice(0,10);
  // Stats
  const totalHours = p552Records.reduce((s,r) => s + (r.totalHours||0), 0);
  const avgHours   = p552Records.length ? (totalHours / p552Records.length).toFixed(1) : '0';
  const lateCount  = p552Records.filter(r => r.status === 'Geç Giriş').length;
  const absentCount = p552Records.filter(r => r.status === 'Devamsız').length;
  const calcHours = (ci: string, co: string) => {
    const [h1,m1] = ci.split(':').map(Number); const [h2,m2] = co.split(':').map(Number);
    return Math.max(0, parseFloat(((h2*60+m2 - h1*60-m1)/60).toFixed(1)));
  };
  const statusFor = (ci: string) => {
    const [h] = ci.split(':').map(Number);
    if (h > 9) return 'Geç Giriş';
    return 'Normal';
  };
  return (
    <motion.div key="mesai" initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-10}} className="space-y-4">
      <ModuleHeader
        title={tr552?'Mesai & Devam Takibi':'Time & Attendance'}
        subtitle={tr552?'Çalışan giriş-çıkış kayıtları ve devam analizi':'Employee check-in/out records and attendance analysis'}
        icon={Clock}
        actionButton={hasFullAccess('ik') ? (
          <button onClick={()=>setP552AddForm(f=>!f)} className="apple-button-primary px-4 py-2 text-sm flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" />{tr552?'Kayıt Ekle':'Add Record'}
          </button>
        ) : undefined}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: tr552?'Toplam Kayıt':'Total Records',  v: String(p552Records.length), color:'text-blue-600',   bg:'bg-blue-50' },
          { label: tr552?'Ort. Çalışma':'Avg Hours/Day', v: `${avgHours}h`,              color:'text-emerald-600',bg:'bg-emerald-50' },
          { label: tr552?'Geç Giriş':'Late Arrivals',    v: String(lateCount),           color:'text-orange-600', bg:'bg-orange-50' },
          { label: tr552?'Devamsız':'Absent',            v: String(absentCount),         color:'text-red-600',    bg:'bg-red-50' },
        ].map(k=>(
          <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">{k.label}</p>
            <p className={`text-2xl font-bold ${k.color}`}>{k.v}</p>
          </div>
        ))}
      </div>
      {p552AddForm && (
        <div className="apple-card p-5 border-2 border-brand/20 space-y-3">
          <h4 className="font-bold text-gray-800">{tr552?'Yeni Mesai Kaydı':'New Attendance Record'}</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input value={p552Draft.employeeName} onChange={e=>setP552Draft(d=>({...d,employeeName:e.target.value}))} placeholder={tr552?'Çalışan Adı':'Employee Name'} className="apple-input px-3 py-2 text-sm" />
            <input type="date" value={p552Draft.date} onChange={e=>setP552Draft(d=>({...d,date:e.target.value}))} className="apple-input px-3 py-2 text-sm" />
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 shrink-0">{tr552?'Giriş':'In'}</label>
              <input type="time" value={p552Draft.checkIn} onChange={e=>setP552Draft(d=>({...d,checkIn:e.target.value}))} className="apple-input px-3 py-2 text-sm flex-1" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 shrink-0">{tr552?'Çıkış':'Out'}</label>
              <input type="time" value={p552Draft.checkOut} onChange={e=>setP552Draft(d=>({...d,checkOut:e.target.value}))} className="apple-input px-3 py-2 text-sm flex-1" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={async()=>{
              if(!p552Draft.employeeName) return;
              const hours = calcHours(p552Draft.checkIn, p552Draft.checkOut);
              const status = statusFor(p552Draft.checkIn);
              await addDoc(collection(db,'timeAttendance'),{...p552Draft,totalHours:hours,status,createdAt:serverTimestamp()});
              setP552AddForm(false); setP552Draft({employeeName:'',date:today552,checkIn:'09:00',checkOut:'18:00'});
            }} className="apple-button-primary px-4 py-2 text-sm">{tr552?'Kaydet':'Save'}</button>
            <button onClick={()=>setP552AddForm(false)} className="apple-button-secondary px-4 py-2 text-sm">{tr552?'İptal':'Cancel'}</button>
          </div>
        </div>
      )}
      <div className="apple-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/60">
              <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-400 uppercase">{tr552?'Çalışan':'Employee'}</th>
              <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-400 uppercase hidden sm:table-cell">{tr552?'Tarih':'Date'}</th>
              <th className="px-4 py-2.5 text-center text-xs font-bold text-gray-400 uppercase">{tr552?'Giriş':'Check-In'}</th>
              <th className="px-4 py-2.5 text-center text-xs font-bold text-gray-400 uppercase">{tr552?'Çıkış':'Check-Out'}</th>
              <th className="px-4 py-2.5 text-right text-xs font-bold text-gray-400 uppercase">{tr552?'Saat':'Hours'}</th>
              <th className="px-4 py-2.5 text-center text-xs font-bold text-gray-400 uppercase">{tr552?'Durum':'Status'}</th>
            </tr></thead>
            <tbody>
              {p552Records.map(r=>{
                const sc = r.status==='Normal'?'bg-emerald-100 text-emerald-700':r.status==='Geç Giriş'?'bg-orange-100 text-orange-700':r.status==='Devamsız'?'bg-red-100 text-red-700':'bg-blue-100 text-blue-700';
                return (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-800">{r.employeeName}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs hidden sm:table-cell">{r.date}</td>
                    <td className="px-4 py-2.5 text-center text-gray-700 tabular-nums">{r.checkIn}</td>
                    <td className="px-4 py-2.5 text-center text-gray-700 tabular-nums">{r.checkOut}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-gray-800 tabular-nums">{r.totalHours}h</td>
                    <td className="px-4 py-2.5 text-center"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sc}`}>{r.status}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {p552Records.length===0 && (
          <div className="text-center py-12 space-y-2">
            <Clock className="w-10 h-10 text-gray-200 mx-auto" />
            <p className="text-gray-400 text-sm">{tr552?'"Kayıt Ekle" ile mesai takibine başlayın':'Click "Add Record" to start tracking attendance'}</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
