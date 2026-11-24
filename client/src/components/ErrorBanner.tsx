interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

/** Accessible customer-facing error, with diagnostics kept out of the UI. */
export default function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  return (
    <div className="error-banner" role="alert">
      <div>
        <strong className="error-banner__title">Could not complete that</strong>
        <p className="error-banner__message">{message}</p>
      </div>
      <button type="button" className="error-banner__dismiss" onClick={onDismiss} aria-label="Dismiss error">✕</button>
    </div>
  );
}
