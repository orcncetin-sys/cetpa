import React from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';

interface ModuleHeaderProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  actionButton?: React.ReactNode;
  className?: string;
}

const ModuleHeader: React.FC<ModuleHeaderProps> = ({
  title,
  subtitle,
  icon: Icon,
  actionButton,
  className,
}) => {
  return (
    <div className={cn("flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6", className)}>
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="p-2 bg-brand/10 rounded-lg text-brand shrink-0">
            <Icon className="w-6 h-6" />
          </div>
        )}
        <div>
          <h2 className="text-2xl font-bold text-[#1D1D1F]">
            {title}
          </h2>
          {subtitle && (
            <p className="text-sm text-gray-500 mt-1">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {actionButton && (
        <div className="flex items-center gap-2 min-w-0">
          {actionButton}
        </div>
      )}
    </div>
  );
};

export default ModuleHeader;
