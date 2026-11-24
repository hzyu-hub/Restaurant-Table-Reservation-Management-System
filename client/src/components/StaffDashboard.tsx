import type { ReservationStatus, StaffReservation } from '../api.ts';
import { NEXT_STATUSES, formatRestaurantTime, statusActionLabel } from '../staff.ts';

interface StaffDashboardProps {
  date: string;
  minDate: string | null;
  timeZone: string;
  reservations: StaffReservation[];
  loading: boolean;
  pendingReference: string | null;
  onDateChange: (date: string) => void;
  onStatusChange: (reference: string, status: ReservationStatus) => void;
  onToday: () => void;
  onRefresh: () => void;
}

/** One day's reservations, with the status changes the matrix allows. */
export default function StaffDashboard({
  date,
  minDate,
  timeZone,
  reservations,
  loading,
  pendingReference,
  onDateChange,
  onStatusChange,
  onToday,
  onRefresh,
}: StaffDashboardProps) {
  return (
    <section className="dashboard">
      <div className="dashboard__bar">
        <label className="field">
          <span className="field__label">Date</span>
          <input
            type="date"
            name="staffDate"
            value={date}
            min={minDate ?? undefined}
            disabled={pendingReference !== null}
            onChange={(event) => {
              onDateChange(event.target.value);
            }}
          />
        </label>
        <div className="toolbar-actions">
          <button type="button" className="ghost-button" onClick={onToday}
            disabled={loading || pendingReference !== null}>Today</button>
          <button type="button" className="ghost-button" onClick={onRefresh}
            disabled={loading || pendingReference !== null}>Refresh</button>
        </div>
      </div>

      {loading ? (
        <p className="slots-empty" role="status">
          Loading reservations…
        </p>
      ) : reservations.length === 0 ? (
        <p className="slots-empty">No reservations on this date.</p>
      ) : (
        <ul className="reservation-list">
          {reservations.map((reservation) => {
            const actions = NEXT_STATUSES[reservation.status];
            const busy = pendingReference !== null;
            return (
              <li key={reservation.reference} className="reservation">
                <div className="reservation__main">
                  <p className="reservation__time">
                    {formatRestaurantTime(reservation.startTime, timeZone)}
                    <span className={`status status--${reservation.status.toLowerCase()}`}>
                      {reservation.status.replace('_', ' ')}
                    </span>
                  </p>
                  <p className="reservation__who">
                    {reservation.customerName}, {reservation.partySize}{' '}
                    {reservation.partySize === 1 ? 'guest' : 'guests'}, table{' '}
                    {reservation.table.label}
                  </p>
                  <p className="reservation__contact">
                    {reservation.customerPhone}
                    {reservation.customerEmail !== null
                      ? ` · ${reservation.customerEmail}`
                      : ''}
                    {' · '}
                    <span className="reservation__reference">{reservation.reference}</span>
                  </p>
                </div>
                {actions.length > 0 && (
                  <div className="reservation__actions">
                    {actions.map((status) => (
                      <button
                        key={status}
                        type="button"
                        className={
                          status === 'CANCELLED' || status === 'NO_SHOW'
                            ? 'ghost-button ghost-button--danger'
                            : 'ghost-button'
                        }
                        disabled={busy}
                        onClick={() => {
                          onStatusChange(reservation.reference, status);
                        }}
                      >
                        {statusActionLabel(status)}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
