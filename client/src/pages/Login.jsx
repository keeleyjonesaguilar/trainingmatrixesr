import { useState } from 'react';
import { api } from '../api';
import esrLogo from '../assets/brand/esr-logo-full.png';
import { APP_VERSION } from '../version';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Set once a password check succeeds for an account with MFA enabled - switches the form to
  // the code-entry step instead of logging in immediately.
  const [mfaToken, setMfaToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');

  // Forgot-password sub-view.
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotUsername, setForgotUsername] = useState('');
  const [forgotMessage, setForgotMessage] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = await api.login(username.trim(), password, rememberMe);
      if (result.mfaRequired) {
        setMfaToken(result.mfaToken);
      } else {
        onLogin(result.username, result.role, result.full_name);
      }
    } catch (err) {
      setError(err.message || 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitMfa = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = await api.verifyMfaLogin(mfaToken, mfaCode.trim());
      onLogin(result.username, result.role, result.full_name);
    } catch (err) {
      setError(err.message || 'Verification failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitForgotPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = await api.forgotPassword(forgotUsername.trim());
      setForgotMessage(result.message);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (showForgotPassword) {
    return (
      <div className="login-screen">
        <form className="login-card" onSubmit={submitForgotPassword}>
          <div className="login-brand">
            <img src={esrLogo} alt="Evolution Safety Resources" />
          </div>

          {error && <div className="error-banner">{error}</div>}

          {forgotMessage ? (
            <p className="login-footnote">{forgotMessage}</p>
          ) : (
            <>
              <div className="field-row">
                <label htmlFor="forgot-username">Username</label>
                <input
                  id="forgot-username"
                  type="text"
                  autoFocus
                  autoComplete="username"
                  value={forgotUsername}
                  onChange={(e) => setForgotUsername(e.target.value)}
                />
              </div>
              <p className="login-footnote">
                If your account has an email address on file, we&apos;ll send a password reset link to it.
              </p>
              <button type="submit" disabled={submitting || !forgotUsername}>
                {submitting ? 'Sending...' : 'Send Reset Link'}
              </button>
            </>
          )}
          <button
            type="button"
            className="link-button"
            onClick={() => { setShowForgotPassword(false); setForgotUsername(''); setForgotMessage(''); setError(''); }}
          >
            Back to sign in
          </button>
          <p className="login-version">{APP_VERSION}</p>
        </form>
      </div>
    );
  }

  if (mfaToken) {
    return (
      <div className="login-screen">
        <form className="login-card" onSubmit={submitMfa}>
          <div className="login-brand">
            <img src={esrLogo} alt="Evolution Safety Resources" />
          </div>

          {error && <div className="error-banner">{error}</div>}

          <div className="field-row">
            <label htmlFor="login-mfa-code">6-digit code</label>
            <input
              id="login-mfa-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={9}
              placeholder="123456"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
            />
          </div>
          <p className="login-footnote">
            Enter the code from your authenticator app, or one of your backup recovery codes.
          </p>

          <button type="submit" disabled={submitting || !mfaCode}>
            {submitting ? 'Verifying...' : 'Verify'}
          </button>
          <button type="button" className="link-button" onClick={() => { setMfaToken(''); setMfaCode(''); setError(''); }}>
            Back to sign in
          </button>
          <p className="login-version">{APP_VERSION}</p>
        </form>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <img src={esrLogo} alt="Evolution Safety Resources" />
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="field-row">
          <label htmlFor="login-username">Username</label>
          <input
            id="login-username"
            type="text"
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="field-row">
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="field-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input
            id="login-remember-me"
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
          />
          <label htmlFor="login-remember-me" style={{ fontWeight: 400 }}>Remember me on this device</label>
        </div>

        <button type="submit" disabled={submitting || !username || !password}>
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>
        <button type="button" className="link-button" onClick={() => setShowForgotPassword(true)}>
          Forgot password?
        </button>

        <p className="login-footnote">Safety Training Matrix &mdash; authorized personnel only.</p>
        <p className="login-version">{APP_VERSION}</p>
      </form>
    </div>
  );
}
