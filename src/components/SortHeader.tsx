import React from 'react';
import { TrendingUp } from 'lucide-react';
import { cn } from '../lib/utils';

interface SortHeaderProps {
  label: string;
  sortKey: string;
  currentSort: { key: string; direction: 'asc' | 'desc' };
  onSort: (key: string) => void;
  className?: string;
}

const SortHeader: React.FC<SortHeaderProps> = ({
  label, sortKey, currentSort, onSort, className,
}) => {
  const isActive = currentSort.key === sortKey;
  return (
    <th
      className={cn(
        'px-6 py-4 text-xs font-bold text-[#86868B] uppercase tracking-wider cursor-pointer hover:bg-gray-100/50 transition-colors group',
        className,
      )}
      onClick={() => onSort(sortKey)}
    >
      <div className="flex items-center gap-1.5">
        {label}
        <TrendingUp className={cn(
          'w-3 h-3 transition-all opacity-0 group-hover:opacity-100',
          isActive ? 'opacity-100 text-brand' : 'text-gray-300',
          isActive && currentSort.direction === 'desc' ? 'rotate-180' : '',
        )} />
      </div>
    </th>
  );
};

export default SortHeader;
