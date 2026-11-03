import { useState, type FormEvent } from 'react';

export interface CustomerFormValues {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
}

interface BookingFormProps {
  selectedTimeLabel: string | null;
  partySize: number;
  submitting: boolean;
  onSubmit: (values: CustomerFormValues) => void;
}

/** Collects the customer's contact details for the selected slot. */
export default function BookingForm({
  selectedTimeLabel,
  partySize,
  submitting,
  onSubmit,
}: BookingFormProps) {
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');

  const canSubmit =
    selectedTimeLabel !== null &&
    customerName.trim().length >= 2 &&
    customerPhone.trim().length >= 10 &&
    !submitting;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    onSubmit({
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim(),
      customerPhone: customerPhone.trim(),
    });
  };

  return (
    <form className="booking-form" onSubmit={handleSubmit} noValidate>
      <h2>Your details</h2>

      <p className="booking-form__summary">
        {selectedTimeLabel === null
          ? 'Select a time above to continue.'
          : `${partySize} ${partySize === 1 ? 'guest' : 'guests'} at ${selectedTimeLabel}`}
      </p>

      <label className="field">
        <span className="field__label">Full name</span>
        <input
          type="text"
          name="customerName"
          autoComplete="name"
          required
          minLength={2}
          maxLength={80}
          value={customerName}
          onChange={(event) => {
            setCustomerName(event.target.value);
          }}
          placeholder="Ada Lovelace"
        />
      </label>

      <label className="field">
        <span className="field__label">Phone</span>
        <input
          type="tel"
          name="customerPhone"
          autoComplete="tel"
          required
          value={customerPhone}
          onChange={(event) => {
            setCustomerPhone(event.target.value);
          }}
          placeholder="416-555-0134"
        />
      </label>

      <label className="field">
        <span className="field__label">
          Email <span className="field__optional">(optional)</span>
        </span>
        <input
          type="email"
          name="customerEmail"
          autoComplete="email"
          value={customerEmail}
          onChange={(event) => {
            setCustomerEmail(event.target.value);
          }}
          placeholder="ada@example.com"
        />
      </label>

      <button type="submit" className="primary-button" disabled={!canSubmit}>
        {submitting ? 'Booking…' : 'Confirm reservation'}
      </button>
    </form>
  );
}
