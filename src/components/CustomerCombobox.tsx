import React, { useState } from 'react';
import { Search } from 'lucide-react';
import type { Lead } from '../types';

interface CustomerComboboxProps {
  leads: Lead[];
  value: string;
  onChange: (value: string) => void;
  onSelect: (lead: Lead) => void;
  placeholder?: string;
  maxResults?: number;
  blurDelayMs?: number;
  showIcon?: boolean;
  inputClassName?: string;
  dropdownMaxHeightClass?: string;
  renderSecondaryLine?: (lead: Lead) => React.ReactNode;
  emptyText?: string;
  footer?: React.ReactNode;
  autoFocus?: boolean;
}

export default function CustomerCombobox({
  leads,
  value,
  onChange,
  onSelect,
  placeholder,
  maxResults = 8,
  blurDelayMs = 200,
  showIcon = true,
  inputClassName = 'apple-input',
  dropdownMaxHeightClass = 'max-h-48',
  renderSecondaryLine,
  emptyText,
  footer,
  autoFocus,
}: CustomerComboboxProps) {
  const [open, setOpen] = useState(false);

  const q = value.trim().toLowerCase();
  const matches = leads
    .filter(l => !q || l.name.toLowerCase().includes(q) || l.company?.toLowerCase().includes(q))
    .slice(0, maxResults);

  const handleSelect = (lead: Lead) => {
    onSelect(lead);
    setOpen(false);
  };

  const showDropdown = open && (matches.length > 0 || (leads.length === 0 && !!emptyText) || !!footer);

  return (
    <div className="relative">
      {showIcon && <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />}
      <input
        type="text"
        autoFocus={autoFocus}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), blurDelayMs)}
        className={inputClassName}
      />
      {showDropdown && (
        <div className={`absolute top-full left-0 right-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-xl z-20 ${dropdownMaxHeightClass} overflow-y-auto`}>
          {matches.map(lead => (
            <button
              key={lead.id}
              type="button"
              onMouseDown={e => { e.preventDefault(); handleSelect(lead); }}
              className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
            >
              <p className="text-sm font-semibold text-[#1D1D1F]">{lead.name}</p>
              {renderSecondaryLine && <p className="text-[11px] text-[#86868B]">{renderSecondaryLine(lead)}</p>}
            </button>
          ))}
          {matches.length === 0 && leads.length === 0 && emptyText && (
            <p className="px-4 py-3 text-xs text-[#86868B]">{emptyText}</p>
          )}
          {footer}
        </div>
      )}
    </div>
  );
}
