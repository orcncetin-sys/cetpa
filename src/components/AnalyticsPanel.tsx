import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import { format } from 'date-fns';
import { tr, enUS } from 'date-fns/locale';

interface AnalyticsPanelProps { orders: { status?: string, syncedAt?: { toDate?: () => Date } | string | number | Date, totalPrice?: number }[]; currentLanguage: 'tr' | 'en'; }

const AnalyticsPanel: React.FC<AnalyticsPanelProps> = ({ orders, currentLanguage }) => {
  const data = useMemo(() => {
    const salesByMonth = orders.reduce((acc: Record<string, number>, order) => {
      if (order.status === 'Cancelled') return acc;
      let date = new Date();
      if (order.syncedAt) {
        date = (order.syncedAt as { toDate?: () => Date }).toDate && typeof (order.syncedAt as { toDate: () => Date }).toDate === 'function' 
          ? (order.syncedAt as { toDate: () => Date }).toDate() 
          : new Date(order.syncedAt as string | number | Date);
      }
      const monthName = format(date, 'MMM', { locale: currentLanguage === 'tr' ? tr : enUS });
      acc[monthName] = (acc[monthName] || 0) + (Number(order.totalPrice) || 0);
      return acc;
    }, {});

    return Object.entries(salesByMonth).map(([name, sales]) => ({ name, sales }));
  }, [orders, currentLanguage]);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="apple-card p-6">
        <h3 className="font-bold text-gray-800 mb-6">{currentLanguage === 'tr' ? 'Satış Trendleri' : 'Sales Trends'}</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.length > 0 ? data : [{ name: currentLanguage === 'tr' ? 'Veri Yok' : 'No Data', sales: 0 }]}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="sales" stroke="#ff4000" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </motion.div>
  );
};

export default AnalyticsPanel;
