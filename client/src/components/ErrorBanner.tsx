interface ErrorBannerProps {
  message: string;
  code: string;
  onDismiss: () => void;
}

/** Inline, dismissible error straight from the API (never a stack trace). */
export default function ErrorBanner({ message, code, onDismiss }: ErrorBannerProps) {
  return (
    <div className="error-banner" role="alert">
      <div>
        <strong className="error-banner__title">Could not complete that</strong>
        <p className="error-banner__message">{message}</p>
        <p className="error-banner__code">Code: {code}</p>
      </div>
      <button
        type="button"
        className="error-banner__dismiss"
        onClick={onDismiss}
        aria-label="Dismiss error"
      >
        ✕
      </button>
    </div>
  );
}
