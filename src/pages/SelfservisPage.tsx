/**
 * SelfservisPage — Çalışan Self-Servis Portalı sekmesi (Phase 553).
 * Kullanıcının e-postasıyla eşleşen çalışan kartı, bordro geçmişi ve
 * son 30 günlük mesai özeti (timeAttendance / p552Records üzerinden).
 *
 * App.tsx'ten ÇIKARILDI (2026-09-03, App.tsx bölme hattı — selfservis bloğu
 * ~94 satırdı). Davranış birebir taşındı: gövde bayt-bayt kesildi, yalnız
 * girinti tekdüze azaltıldı.
 */
import { motion } from 'motion/react';
import { UserCheck, Users } from 'lucide-react';
import ModuleHeader from '../components/ModuleHeader';
import type { Employee, Payroll } from '../types';

/** IKPage.tsx / MesaiPage.tsx'teki AttendanceRecord ile birebir aynı tanım. */
export interface AttendanceRecord { id: string; employeeName: string; employeeId?: string; date: string; checkIn: string; checkOut: string; totalHours: number; status: 'Normal' | 'Geç Giriş' | 'Erken Çıkış' | 'Devamsız' | 'İzinli' }

interface Props {
  currentLanguage: 'tr' | 'en';
  /** Yalnız e-posta eşleşmesi için kullanılıyor (firebase User yapısal olarak uyar). */
  user: { email?: string | null } | null;
  employees: Employee[];
  payrolls: Payroll[];
  p552Records: AttendanceRecord[];
}

export default function SelfservisPage({
  currentLanguage, user, employees, payrolls, p552Records,
}: Props) {
  const tr553 = currentLanguage === 'tr';
  // Find current user's employee record by email
  const myEmp = employees.find(e => e.email === user?.email);
  const myPayrolls = payrolls.filter(p => myEmp && (p.employeeId === myEmp.id || p.employeeName === myEmp.name)).sort((a,b) => {
    const ay = a.year*100+a.month; const by = b.year*100+b.month; return by-ay;
  });
  return (
    <motion.div key="selfservis" initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-10}} className="space-y-4">
      <ModuleHeader title={tr553?'Self-Servis Portalım':'My Self-Service Portal'} subtitle={tr553?'Kişisel bilgiler, maaş bordroları ve izin bakiyeniz':'Personal info, payslips and leave balance'} icon={UserCheck} />
      {!myEmp ? (
        <div className="apple-card p-8 text-center space-y-3">
          <Users className="w-12 h-12 text-gray-200 mx-auto" />
          <p className="text-gray-400">{tr553?'Hesabınıza bağlı bir çalışan kaydı bulunamadı.':'No employee record found linked to your account.'}</p>
          <p className="text-xs text-gray-400">{tr553?`(${user?.email})`:`(${user?.email})`}</p>
        </div>
      ) : (
        <>
          {/* Employee card */}
          <div className="apple-card p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-brand/10 flex items-center justify-center shrink-0">
              <span className="text-2xl font-black text-brand">{myEmp.name.charAt(0)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-gray-900 text-lg">{myEmp.name}</p>
              <p className="text-sm text-gray-500">{myEmp.position} · {myEmp.department}</p>
              <p className="text-xs text-gray-400 mt-0.5">{myEmp.email} · {myEmp.phone}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-gray-400">{tr553?'Başlangıç':'Start Date'}</p>
              <p className="font-semibold text-gray-700">{myEmp.startDate}</p>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mt-1 inline-block ${myEmp.status==='Aktif'?'bg-emerald-100 text-emerald-700':'bg-gray-100 text-gray-600'}`}>{myEmp.status}</span>
            </div>
          </div>
          {/* Payroll history */}
          <div className="apple-card p-5">
            <h4 className="font-bold text-gray-800 mb-3">{tr553?'Maaş Geçmişi':'Payroll History'}</h4>
            {myPayrolls.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">{tr553?'Bordro kaydı bulunamadı.':'No payroll records found.'}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100">
                    <th className="py-2 text-left text-xs font-bold text-gray-400 uppercase">{tr553?'Dönem':'Period'}</th>
                    <th className="py-2 text-right text-xs font-bold text-gray-400 uppercase">{tr553?'Brüt':'Gross'}</th>
                    <th className="py-2 text-right text-xs font-bold text-gray-400 uppercase">{tr553?'Kesinti':'Deductions'}</th>
                    <th className="py-2 text-right text-xs font-bold text-gray-400 uppercase">{tr553?'Net':'Net'}</th>
                    <th className="py-2 text-center text-xs font-bold text-gray-400 uppercase">{tr553?'Durum':'Status'}</th>
                  </tr></thead>
                  <tbody>
                    {myPayrolls.slice(0,12).map((p,i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className="py-2 text-gray-700">{p.year}/{String(p.month).padStart(2,'0')}</td>
                        <td className="py-2 text-right tabular-nums text-gray-600">₺{((p.baseSalary||0)+(p.bonus||0)).toLocaleString('tr-TR')}</td>
                        <td className="py-2 text-right tabular-nums text-red-500">-₺{(p.deductions||0).toLocaleString('tr-TR')}</td>
                        <td className="py-2 text-right tabular-nums font-bold text-emerald-700">₺{(p.netSalary||0).toLocaleString('tr-TR')}</td>
                        <td className="py-2 text-center"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.status==='Ödendi'?'bg-emerald-100 text-emerald-700':'bg-orange-100 text-orange-700'}`}>{p.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {/* Mesai summary */}
          {p552Records.filter(r=>r.employeeName===myEmp.name).length > 0 && (
            <div className="apple-card p-5">
              <h4 className="font-bold text-gray-800 mb-3">{tr553?'Mesai Özeti (Son 30 Gün)':'Attendance Summary (Last 30 Days)'}</h4>
              {(() => {
                const cut = new Date(Date.now()-30*86400000).toISOString().slice(0,10);
                const myRecs = p552Records.filter(r=>r.employeeName===myEmp.name && r.date>=cut);
                const totalH = myRecs.reduce((s,r)=>s+(r.totalHours||0),0);
                return (
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: tr553?'Gün':'Days', v: myRecs.length, color:'text-blue-600' },
                      { label: tr553?'Toplam Saat':'Total Hours', v: `${totalH.toFixed(0)}h`, color:'text-emerald-600' },
                      { label: tr553?'Geç Giriş':'Late', v: myRecs.filter(r=>r.status==='Geç Giriş').length, color:'text-orange-600' },
                    ].map(k=>(
                      <div key={k.label} className="text-center">
                        <p className={`text-2xl font-bold ${k.color}`}>{k.v}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{k.label}</p>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
