import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiRequestError,
  createReservation,
  fetchAvailability,
  type AvailabilitySlot,
  type ReservationResponse,
} from './api.ts';
import BookingForm, { type CustomerFormValues } from './components/BookingForm.tsx';
import Confirmation from './components/Confirmation.tsx';
import ErrorBanner from './components/ErrorBanner.tsx';
import SlotPicker from './components/SlotPicker.tsx';

/** Local `YYYY-MM-DD` for the browser's clock (used only as a date default). */
function todayLocalIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${String(now.getFullYear())}-${month}-${day}`;
}

/** Formats a start time in the restaurant's timezone for the summary line. */
function formatSlotLabel(isoInstant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).format(new Date(isoInstant));
}

/**
 * The API wants the restaurant-local wall clock as `HH:mm`. Formatting in the
 * restaurant timezone (rather than the browser's) keeps the value correct even
 * when the customer books from another region.
 */
function toApiClockTime(isoInstant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(isoInstant));
}

interface BannerState {
  code: string;
  message: string;
}

/** Reads an unknown thrown value into a client-safe banner. */
function toBanner(error: unknown): BannerState {
  if (error instanceof ApiRequestError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: 'CLIENT_ERROR', message: error.message };
  }
  return {
    code: 'CLIENT_ERROR',
    message: 'Something unexpected happened. Please try again.',
  };
}

const PARTY_SIZES = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const FALLBACK_TIMEZONE = 'America/Toronto';

export default function App() {
  const [date, setDate] = useState<string>(todayLocalIso);
  const [partySize, setPartySize] = useState<number>(2);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [timeZone, setTimeZone] = useState<string>(FALLBACK_TIMEZONE);
  const [durationMinutes, setDurationMinutes] = useState<number>(90);
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [reservation, setReservation] = useState<ReservationResponse | null>(null);

  /**
   * Loads slots for a date/party size.
   *
   * Deliberately leaves `banner` alone: a conflict refresh happens *after* the
   * error has been set, and clearing it here would erase the explanation the
   * customer needs. Callers decide when an error is stale.
   */
  const loadAvailability = useCallback(
    async (targetDate: string, targetPartySize: number): Promise<void> => {
      setLoading(true);
      try {
        const result = await fetchAvailability(targetDate, targetPartySize);
        setSlots(result.slots);
        setTimeZone(result.timezone);
        setDurationMinutes(result.durationMinutes);
        setSelectedSlot((current) => {
          if (current === null) {
            return null;
          }
          const stillOpen = result.slots.find(
            (slot) => slot.startTime === current.startTime,
          );
          return stillOpen !== undefined && stillOpen.available ? stillOpen : null;
        });
      } catch (error: unknown) {
        setSlots([]);
        setSelectedSlot(null);
        setBanner(toBanner(error));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    setBanner(null);
    setSelectedSlot(null);
    void loadAvailability(date, partySize);
  }, [date, partySize, loadAvailability]);

  const selectedTimeLabel = useMemo(() => {
    if (selectedSlot === null) {
      return null;
    }
    return formatSlotLabel(selectedSlot.startTime, timeZone);
  }, [selectedSlot, timeZone]);

  const handleSubmit = async (values: CustomerFormValues): Promise<void> => {
    if (selectedSlot === null) {
      return;
    }

    setSubmitting(true);
    setBanner(null);
    try {
      const created = await createReservation({
        customerName: values.customerName,
        customerEmail:
          values.customerEmail.length > 0 ? values.customerEmail : undefined,
        customerPhone: values.customerPhone,
        partySize,
        date,
        time: toApiClockTime(selectedSlot.startTime, timeZone),
      });
      setReservation(created);
    } catch (error: unknown) {
      setBanner(toBanner(error));
      // A conflict means someone took the slot: refresh so the UI tells the truth.
      if (error instanceof ApiRequestError && error.status === 409) {
        await loadAvailability(date, partySize);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleBookAnother = (): void => {
    setReservation(null);
    setSelectedSlot(null);
    void loadAvailability(date, partySize);
  };

  if (reservation !== null) {
    return (
      <main className="page">
        <div className="card">
          <h1 className="brand">Table Reservations</h1>
          <Confirmation
            reservation={reservation}
            timeZone={timeZone}
            onBookAnother={handleBookAnother}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="card">
        <header className="page-header">
          <h1 className="brand">Table Reservations</h1>
          <p className="subtitle">
            Open daily 11:00&nbsp;AM – 10:00&nbsp;PM. Bookings last{' '}
            {durationMinutes} minutes.
          </p>
        </header>

        {banner !== null && (
          <ErrorBanner
            code={banner.code}
            message={banner.message}
            onDismiss={() => {
              setBanner(null);
            }}
          />
        )}

        <section className="controls">
          <label className="field">
            <span className="field__label">Date</span>
            <input
              type="date"
              name="date"
              value={date}
              min={todayLocalIso()}
              onChange={(event) => {
                setDate(event.target.value);
                setSelectedSlot(null);
              }}
            />
          </label>

          <label className="field">
            <span className="field__label">Party size</span>
            <select
              name="partySize"
              value={partySize}
              onChange={(event) => {
                setPartySize(Number(event.target.value));
                setSelectedSlot(null);
              }}
            >
              {PARTY_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} {size === 1 ? 'guest' : 'guests'}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="availability">
          <h2>Pick a time</h2>
          {loading ? (
            <p className="slots-empty" role="status">
              Loading available times…
            </p>
          ) : (
            <SlotPicker
              slots={slots}
              timeZone={timeZone}
              selectedStartTime={selectedSlot?.startTime ?? null}
              disabled={submitting}
              onSelect={(slot) => {
                setSelectedSlot(slot);
                setBanner(null);
              }}
            />
          )}
        </section>

        <BookingForm
          selectedTimeLabel={selectedTimeLabel}
          partySize={partySize}
          submitting={submitting}
          onSubmit={(values) => {
            void handleSubmit(values);
          }}
        />
      </div>
    </main>
  );
}
