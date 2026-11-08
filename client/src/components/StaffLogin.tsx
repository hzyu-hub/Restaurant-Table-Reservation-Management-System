interface StaffLoginProps {
  submitting: boolean;
  onSubmit: (username: string, password: string) => void;
}

/** Username and password form. Credentials are not stored in the browser. */
export default function StaffLogin({ submitting, onSubmit }: StaffLoginProps) {
  return (
    <form
      className="booking-form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const username = String(data.get('username') ?? '');
        const password = String(data.get('password') ?? '');
        onSubmit(username, password);
      }}
    >
      <label className="field">
        <span className="field__label">Username</span>
        <input
          name="username"
          type="text"
          autoComplete="username"
          required
          disabled={submitting}
        />
      </label>
      <label className="field">
        <span className="field__label">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={submitting}
        />
      </label>
      <button className="primary-button" type="submit" disabled={submitting}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
