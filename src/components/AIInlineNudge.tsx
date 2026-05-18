import React from 'react';
import { cn } from '../lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AIInlineNudgeProps {
  context: 'inventory' | 'orders' | 'crm' | 'muhasebe';
  data: {
    lowStockCount?: number;
    pendingOrderCount?: number;
    overdueLeadCount?: number;
    staleInvoiceCount?: number;
    topRisk?: string;
  };
  currentLanguage: string;
  onAction?: (action: string) => void;
  className?: string;
}

interface NudgeChip {
  icon: string;
  label: string;
  actionId: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AIInlineNudge({
  context,
  data,
  onAction,
  className,
}: AIInlineNudgeProps) {
  const chips: NudgeChip[] = [];

  // Context-specific chips
  if (context === 'inventory' && (data.lowStockCount ?? 0) > 0) {
    chips.push({
      icon: '⚠️',
      label: `${data.lowStockCount} ürün kritik stokta`,
      actionId: 'go-low-stock',
    });
  }

  if (context === 'orders' && (data.pendingOrderCount ?? 0) > 0) {
    chips.push({
      icon: '📦',
      label: `${data.pendingOrderCount} sipariş bekliyor`,
      actionId: 'go-pending',
    });
  }

  if (context === 'crm' && (data.overdueLeadCount ?? 0) > 0) {
    chips.push({
      icon: '📞',
      label: `${data.overdueLeadCount} lead takip bekliyor`,
      actionId: 'go-overdue-leads',
    });
  }

  if (context === 'muhasebe' && (data.staleInvoiceCount ?? 0) > 0) {
    chips.push({
      icon: '🧾',
      label: `${data.staleInvoiceCount} fatura vadesi geçmiş`,
      actionId: 'go-stale-invoices',
    });
  }

  // Universal topRisk chip (any context)
  if (data.topRisk) {
    chips.push({
      icon: '⚡',
      label: data.topRisk,
      actionId: 'go-top-risk',
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {chips.map((chip) => (
        <button
          key={chip.actionId}
          type="button"
          onClick={() => onAction?.(chip.actionId)}
          className="bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold rounded-full px-3 py-1.5 hover:bg-amber-100 cursor-pointer transition-colors flex items-center gap-1.5"
        >
          <span aria-hidden="true">{chip.icon}</span>
          <span>{chip.label}</span>
        </button>
      ))}
    </div>
  );
}
