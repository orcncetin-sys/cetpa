import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { format, subMonths, startOfMonth } from 'date-fns';
import { tr as trLocale, enUS } from 'date-fns/locale';
import { TrendingUp, TrendingDown, ShoppingCart, Users, Package, DollarSign } from 'lucide-react';
import { zamanMs } from '../utils/zaman';

interface Order {
  status?: string;
  syncedAt?: unknown;   // kanonik src/types.ts ile ayni (bkz. zamanMs)
  totalPrice?: number;
  assignedTo?: string | null;   // kanonik tipte null da olabiliyor
  customerId?: string;
  customerName?: string;
  items?: { productId?: string; name?: string; qty?: number; price?: number }[];
}

interface Lead {
  status?: string;
  createdAt?: unknown;  // kanonik src/types.ts ile ayni (bkz. zamanMs)
  value?: number;
  source?: string;
}

interface InventoryItem {
  name?: string;
  stockLevel?: number;
  prices?: Record<string, number>;
}

interface AnalyticsPanelProps {
  orders: Order[];
  leads?: Lead[];
  inventory?: InventoryItem[];
  currentLanguage: 'tr' | 'en';
}

const BRAND = '#ff4000';
const COLORS = ['#ff4000', '#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

// YEREL `toDate` KALDIRILDI (2026-08-26). `if (!val) return new Date()` yuzunden
// tarihi COZULEMEYEN her siparis "SIMDI" sayiliyordu; asagidaki
// `>= thisMonth` suzgeci de onu ICINDE BULUNULAN AYIN CIROSUNA katiyordu.
// Yani Mikro'dan syncedAt'siz gelen kayitlar bu ayin gelirini SISIRIYORDU.
// `zamanMs` cozemezse null doner (asla "simdi"); cagri yerleri artik disliyor.

const AnalyticsPanel: React.FC<AnalyticsPanelProps> = ({
  orders = [],
  leads = [],
  inventory = [],
  currentLanguage,
}) => {
  const t = currentLanguage === 'tr';
  const locale = t ? trLocale : enUS;

  /* ── KPI cards ── */
  const kpis = useMemo(() => {
    const activeOrders = orders.filter(o => o.status !== 'Cancelled');
    const totalRevenue = activeOrders.reduce((s, o) => s + (Number(o.totalPrice) || 0), 0);

    const now = new Date();
    const thisMonth = startOfMonth(now);
    const lastMonth = startOfMonth(subMonths(now, 1));

    // Tarihi cozulemeyen siparis HICBIR aya sayilmaz (eskiden hepsi bu aya
    // dusuyordu). Bir aya ait oldugu bilinmiyorsa o ayin cirosu olarak
    // gosterilemez — CLAUDE.md: "sahte kesinlik gosterme".
    const thisMonthRevenue = activeOrders
      .filter(o => { const ms = zamanMs(o.syncedAt); return ms !== null && ms >= thisMonth.getTime(); })
      .reduce((s, o) => s + (Number(o.totalPrice) || 0), 0);
    const lastMonthRevenue = activeOrders
      .filter(o => { const ms = zamanMs(o.syncedAt); return ms !== null && ms >= lastMonth.getTime() && ms < thisMonth.getTime(); })
      .reduce((s, o) => s + (Number(o.totalPrice) || 0), 0);

    const revenueGrowth = lastMonthRevenue > 0
      ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
      : 0;

    const activeLeads = leads.filter(l => l.status !== 'Lost' && l.status !== 'Closed');
    const convertedLeads = leads.filter(l => l.status === 'Won' || l.status === 'Closed');
    const conversionRate = leads.length > 0 ? (convertedLeads.length / leads.length) * 100 : 0;

    const lowStockCount = inventory.filter(i => (i.stockLevel ?? 0) < 5).length;

    return { totalRevenue, thisMonthRevenue, revenueGrowth, activeLeads: activeLeads.length, conversionRate, totalOrders: activeOrders.length, lowStockCount };
  }, [orders, leads, inventory]);

  /* ── Monthly revenue trend (last 6 months) ── */
  const revenueByMonth = useMemo(() => {
    const months: { name: string; date: Date; revenue: number; orders: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = subMonths(new Date(), i);
      months.push({
        name: format(d, 'MMM', { locale }),
        date: startOfMonth(d),
        revenue: 0,
        orders: 0,
      });
    }
    orders.filter(o => o.status !== 'Cancelled').forEach(o => {
      const ms = zamanMs(o.syncedAt);
      if (ms === null) return;   // aylik grafige tarihsiz kayit girmez
      const d = new Date(ms);
      const idx = months.findIndex(m => format(d, 'MMM yyyy') === format(m.date, 'MMM yyyy'));
      if (idx !== -1) {
        months[idx].revenue += Number(o.totalPrice) || 0;
        months[idx].orders += 1;
      }
    });
    return months;
  }, [orders, locale]);

  /* ── Order status distribution ── */
  const orderStatusData = useMemo(() => {
    const map: Record<string, number> = {};
    orders.forEach(o => {
      const s = o.status || 'Unknown';
      map[s] = (map[s] || 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [orders]);

  /* ── Lead source distribution ── */
  const leadSourceData = useMemo(() => {
    const map: Record<string, number> = {};
    leads.forEach(l => {
      const s = l.source || (t ? 'Diğer' : 'Other');
      map[s] = (map[s] || 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [leads, t]);

  /* ── Top 5 products by revenue ── */
  const topProducts = useMemo(() => {
    const map: Record<string, number> = {};
    orders.filter(o => o.status !== 'Cancelled').forEach(o => {
      (o.items || []).forEach(item => {
        const name = item.name || item.productId || (t ? 'Bilinmiyor' : 'Unknown');
        map[name] = (map[name] || 0) + (Number(item.price) || 0) * (Number(item.qty) || 1);
      });
    });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, revenue]) => ({ name: name.length > 18 ? name.slice(0, 16) + '…' : name, revenue }));
  }, [orders, t]);

  const fmt = (n: number) => n >= 1_000_000
    ? `₺${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
    ? `₺${(n / 1_000).toFixed(0)}K`
    : `₺${n.toFixed(0)}`;

  const KPICard = ({ icon: Icon, label, value, sub, up }: { icon: React.ElementType; label: string; value: string; sub?: string; up?: boolean }) => (
    <div className="apple-card p-5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="w-9 h-9 rounded-xl bg-brand/10 flex items-center justify-center">
          <Icon className="w-4.5 h-4.5 text-brand" />
        </div>
        {sub && (
          <span className={`text-[11px] font-bold flex items-center gap-0.5 ${up ? 'text-emerald-500' : 'text-red-400'}`}>
            {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {sub}
          </span>
        )}
      </div>
      <p className="text-[11px] text-gray-400 font-medium">{label}</p>
      <p className="text-2xl font-black text-gray-900 leading-none">{value}</p>
    </div>
  );

  const hasData = orders.length > 0 || leads.length > 0;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 pb-8">

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          icon={DollarSign}
          label={t ? 'Bu Ay Ciro' : 'This Month Revenue'}
          value={fmt(kpis.thisMonthRevenue)}
          sub={`${kpis.revenueGrowth >= 0 ? '+' : ''}${kpis.revenueGrowth.toFixed(0)}%`}
          up={kpis.revenueGrowth >= 0}
        />
        <KPICard icon={ShoppingCart} label={t ? 'Toplam Sipariş' : 'Total Orders'} value={String(kpis.totalOrders)} />
        <KPICard
          icon={Users}
          label={t ? 'Aktif Lead' : 'Active Leads'}
          value={String(kpis.activeLeads)}
          sub={`${kpis.conversionRate.toFixed(0)}% ${t ? 'dönüşüm' : 'conv.'}`}
          up={kpis.conversionRate > 20}
        />
        <KPICard icon={Package} label={t ? 'Kritik Stok' : 'Low Stock'} value={String(kpis.lowStockCount)} up={kpis.lowStockCount === 0} sub={kpis.lowStockCount === 0 ? (t ? 'Sorun yok' : 'All clear') : (t ? 'Ürün' : 'items')} />
      </div>

      {!hasData && (
        <div className="apple-card p-12 text-center space-y-3">
          <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto">
            <TrendingUp className="w-8 h-8 text-gray-300" />
          </div>
          <p className="font-bold text-gray-400">{t ? 'Henüz veri yok' : 'No data yet'}</p>
          <p className="text-sm text-gray-300">{t ? 'Sipariş ve lead ekledikçe grafikler burada görünür.' : 'Charts will appear as you add orders and leads.'}</p>
        </div>
      )}

      {hasData && (
        <>
          {/* Revenue + Orders trend */}
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 text-sm mb-5">{t ? 'Aylık Ciro & Sipariş Trendi (Son 6 Ay)' : 'Monthly Revenue & Orders (Last 6 Months)'}</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={revenueByMonth} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(val, name) => [name === 'revenue' ? fmt(Number(val)) : val, name === 'revenue' ? (t ? 'Ciro' : 'Revenue') : (t ? 'Sipariş' : 'Orders')]} />
                  <Legend formatter={(val) => val === 'revenue' ? (t ? 'Ciro' : 'Revenue') : (t ? 'Sipariş' : 'Orders')} />
                  <Line yAxisId="left" type="monotone" dataKey="revenue" stroke={BRAND} strokeWidth={2.5} dot={{ fill: BRAND, r: 4 }} />
                  <Line yAxisId="right" type="monotone" dataKey="orders" stroke="#0ea5e9" strokeWidth={2} strokeDasharray="4 2" dot={{ fill: '#0ea5e9', r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Order status donut */}
            <div className="apple-card p-6">
              <h3 className="font-bold text-gray-800 text-sm mb-5">{t ? 'Sipariş Durumları' : 'Order Status Distribution'}</h3>
              {orderStatusData.length > 0 ? (
                <div className="h-52 flex items-center gap-4">
                  <ResponsiveContainer width="55%" height="100%">
                    <PieChart>
                      <Pie data={orderStatusData} dataKey="value" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3}>
                        {orderStatusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-2">
                    {orderStatusData.map((d, i) => (
                      <div key={d.name} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                          <span className="text-[11px] text-gray-600 truncate max-w-[80px]">{d.name}</span>
                        </div>
                        <span className="text-[11px] font-bold text-gray-800">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-52 flex items-center justify-center text-gray-300 text-sm">{t ? 'Sipariş yok' : 'No orders'}</div>
              )}
            </div>

            {/* Lead source bar */}
            <div className="apple-card p-6">
              <h3 className="font-bold text-gray-800 text-sm mb-5">{t ? 'Lead Kaynakları' : 'Lead Sources'}</h3>
              {leadSourceData.length > 0 ? (
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={leadSourceData} layout="vertical" margin={{ left: 0, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={72} />
                      <Tooltip />
                      <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                        {leadSourceData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-52 flex items-center justify-center text-gray-300 text-sm">{t ? 'Lead yok' : 'No leads'}</div>
              )}
            </div>
          </div>

          {/* Top products */}
          {topProducts.length > 0 && (
            <div className="apple-card p-6">
              <h3 className="font-bold text-gray-800 text-sm mb-5">{t ? 'En Çok Satan Ürünler (Ciro)' : 'Top Products by Revenue'}</h3>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topProducts} margin={{ top: 0, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)} />
                    <Tooltip formatter={v => [fmt(Number(v)), t ? 'Ciro' : 'Revenue']} />
                    <Bar dataKey="revenue" fill={BRAND} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
};

export default AnalyticsPanel;
