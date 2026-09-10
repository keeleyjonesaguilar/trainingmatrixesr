import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import esrLogo from '../assets/brand/esr-logo-full.png';

// Reached only via the link in a "forgot password" email (?token=...) - never behind a login,
// same as the Training Sign-In public pages (client/src/pages/PublicSignIn.jsx).
export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) return setError('Password must be at least 8 characters.');
    if (newPassword !== confirmPassword) return setError('Passwords do not match.');
    setSubmitting(true);
    try {
      await api.resetPassword(token, newPassword);
      setDone(true);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <img src={esrLogo} alt="Evolution Safety Resources" />
        </div>

        {!token ? (
          <p className="login-footnote">This reset link is missing its token. Please use the link from your email.</p>
        ) : done ? (
          <>
            <p className="login-footnote">Your password has been reset. You can now sign in.</p>
            <a href="/">
              <button type="button">Go to Sign In</button>
            </a>
          </>
        ) : (
          <form onSubmit={submit}>
            {error && <div className="error-banner">{error}</div>}
            <div className="field-row">
              <label htmlFor="reset-new-password">New password</label>
              <input
                id="reset-new-password"
                type="password"
                autoFocus
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="field-row">
              <label htmlFor="reset-confirm-password">Confirm new password</label>
              <input
                id="reset-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <button type="submit" disabled={submitting || !newPassword || !confirmPassword}>
              {submitting ? 'Saving...' : 'Set New Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
