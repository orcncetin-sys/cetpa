import React from 'react';
import { Calendar } from 'lucide-react';

interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  currentLanguage: string;
}

const DateRangePicker: React.FC<DateRangePickerProps> = ({ startDate, endDate, onStartDateChange, onEndDateChange }) => {
  return (
    <div className="flex items-center gap-2 bg-white rounded-xl border border-gray-100 shadow-sm p-2">
      <Calendar className="w-4 h-4 text-gray-400" />
      <input
        type="date"
        value={startDate}
        onChange={(e) => onStartDateChange(e.target.value)}
        className="text-xs font-semibold text-gray-700 bg-transparent border-none outline-none"
      />
      <span className="text-gray-300">-</span>
      <input
        type="date"
        value={endDate}
        onChange={(e) => onEndDateChange(e.target.value)}
        className="text-xs font-semibold text-gray-700 bg-transparent border-none outline-none"
      />
    </div>
  );
};

export default DateRangePicker;
