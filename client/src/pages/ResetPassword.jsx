import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import esrLogo from '../assets/brand/esr-logo-full.png';

// Reached only via the link in a "forgot password" or "set up your account" email (?token=...) -
// never behind a login, same as the Training Sign-In public pages (client/src/pages/
// PublicSignIn.jsx). An 'invite' token (brand-new account) also asks for a username here, since
// that's the one point where the person claiming it picks their own; a plain 'reset' token only
// ever touches the password.
export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [checking, setChecking] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [isInvite, setIsInvite] = useState(false);
  const [username, setUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setChecking(false); return; }
    api.checkResetToken(token)
      .then((res) => {
        setTokenValid(Boolean(res.valid));
        setIsInvite(res.purpose === 'invite');
      })
      .catch(() => setTokenValid(false))
      .finally(() => setChecking(false));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (isInvite && !username.trim()) return setError('Choose a username.');
    if (newPassword.length < 8) return setError('Password must be at least 8 characters.');
    if (newPassword !== confirmPassword) return setError('Passwords do not match.');
    setSubmitting(true);
    try {
      await api.resetPassword(token, newPassword, isInvite ? username.trim() : undefined);
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
        ) : checking ? (
          <p className="login-footnote">Checking your link...</p>
        ) : !tokenValid ? (
          <p className="login-footnote">This link is invalid or has expired. Please request a new one.</p>
        ) : done ? (
          <>
            <p className="login-footnote">
              {isInvite ? 'Your account is ready. You can now sign in.' : 'Your password has been reset. You can now sign in.'}
            </p>
            <a href="/">
              <button type="button">Go to Sign In</button>
            </a>
          </>
        ) : (
          <form onSubmit={submit}>
            {isInvite && <p className="login-footnote">Choose a username and password to finish setting up your account.</p>}
            {error && <div className="error-banner">{error}</div>}
            {isInvite && (
              <div className="field-row">
                <label htmlFor="reset-username">Username</label>
                <input
                  id="reset-username"
                  type="text"
                  autoFocus
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            )}
            <div className="field-row">
              <label htmlFor="reset-new-password">New password</label>
              <input
                id="reset-new-password"
                type="password"
                autoFocus={!isInvite}
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
            <button type="submit" disabled={submitting || (isInvite && !username.trim()) || !newPassword || !confirmPassword}>
              {submitting ? 'Saving...' : isInvite ? 'Create Account' : 'Set New Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
