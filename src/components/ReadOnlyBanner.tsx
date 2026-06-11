import { Eye } from 'lucide-react';

interface Props { currentLanguage: string; }

const ReadOnlyBanner = ({ currentLanguage }: Props) => (
  <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-100 rounded-xl text-xs font-semibold text-amber-700 mb-4">
    <Eye className="w-3.5 h-3.5 flex-shrink-0" />
    {currentLanguage === 'tr' ? 'Yalnızca Görüntüleme — Bu bölümü düzenleyemezsiniz.' : 'Read Only — You cannot edit this section.'}
  </div>
);

export default ReadOnlyBanner;
