import type { AvailabilitySlot } from '../api.ts';

interface SlotPickerProps {
  slots: AvailabilitySlot[];
  timeZone: string;
  selectedStartTime: string | null;
  onSelect: (slot: AvailabilitySlot) => void;
  disabled: boolean;
}

/** Formats an ISO instant as `h:mm AM/PM` in the restaurant's timezone. */
function formatLocalTime(isoInstant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).format(new Date(isoInstant));
}

/** Grid of 30-minute start-time buttons for the selected date. */
export default function SlotPicker({
  slots,
  timeZone,
  selectedStartTime,
  onSelect,
  disabled,
}: SlotPickerProps) {
  if (slots.length === 0) {
    return (
      <p className="slots-empty" role="status">
        Choose a date and party size to see available times.
      </p>
    );
  }

  const anyAvailable = slots.some((slot) => slot.available);

  return (
    <div className="slot-picker">
      <div className="slot-grid" role="group" aria-label="Available times">
        {slots.map((slot) => {
          const isSelected = selectedStartTime === slot.startTime;
          return (
            <button
              key={slot.startTime}
              type="button"
              className={isSelected ? 'slot slot--selected' : 'slot'}
              disabled={disabled || !slot.available}
              aria-pressed={isSelected}
              title={
                slot.available
                  ? `${String(slot.tablesAvailable)} table(s) available`
                  : 'Fully booked'
              }
              onClick={() => {
                onSelect(slot);
              }}
            >
              {formatLocalTime(slot.startTime, timeZone)}
            </button>
          );
        })}
      </div>
      {!anyAvailable && (
        <p className="slots-empty" role="status">
          No tables left for this date. Try another day or a smaller party.
        </p>
      )}
    </div>
  );
}
