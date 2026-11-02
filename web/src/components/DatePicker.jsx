// A date field: shadcn/ui's Calendar in a Popover, in place of the browser's
// <input type="date">. Values are 'YYYY-MM-DD' strings, like the inputs it
// replaces; `min` / `max` bound the choice and the month dropdowns.

import { useState } from 'react';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { dateLong } from '../lib/format.js';

const pad = (n) => String(n).padStart(2, '0');
// Local-date round trip: a calendar day, never shifted by the time zone.
export const toDate = (ymd) => {
  if (!ymd) return undefined;
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const toYmd = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export default function DatePicker({ value, onChange, min, max, label }) {
  const [open, setOpen] = useState(false);
  const selected = toDate(value);
  const from = toDate(min);
  const to = toDate(max);
  const disabled = [from && { before: from }, to && { after: to }].filter(Boolean);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" aria-label={label} className="date-trigger h-8 justify-start gap-2 px-2.5 font-normal">
          <CalendarIcon className="text-muted-foreground" />
          {value ? dateLong(value) : 'Pick a date'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          captionLayout="dropdown"
          startMonth={from ?? new Date(2015, 0)}
          endMonth={to ?? new Date(new Date().getFullYear() + 1, 11)}
          disabled={disabled}
          onSelect={(d) => {
            if (!d) return; // clicking the chosen day again keeps it
            onChange(toYmd(d));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
