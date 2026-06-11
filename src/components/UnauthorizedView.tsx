import { motion } from 'motion/react';
import { Lock } from 'lucide-react';

interface Props { currentLanguage: string; tab: string; }

const UnauthorizedView = ({ currentLanguage, tab }: Props) => (
  <motion.div key="unauthorized" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
    className="flex flex-col items-center justify-center min-h-[400px] text-center px-4">
    <div className="w-20 h-20 bg-red-50 rounded-3xl flex items-center justify-center mb-6">
      <Lock className="w-10 h-10 text-red-400" />
    </div>
    <h2 className="text-2xl font-bold text-[#1D1D1F] mb-2">
      {currentLanguage === 'tr' ? 'Erişim Kısıtlı' : 'Access Restricted'}
    </h2>
    <p className="text-sm text-gray-500 max-w-sm">
      {currentLanguage === 'tr'
        ? `"${tab}" bölümüne erişim yetkiniz bulunmuyor. Lütfen sisteminize yöneticiye başvurun.`
        : `You don't have permission to access "${tab}". Please contact your system administrator.`}
    </p>
    <div className="mt-6 px-4 py-2.5 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600 font-medium">
      🔒 {currentLanguage === 'tr' ? 'Bu alan yalnızca yetkili personele açıktır.' : 'This area is restricted to authorized personnel only.'}
    </div>
  </motion.div>
);

export default UnauthorizedView;
