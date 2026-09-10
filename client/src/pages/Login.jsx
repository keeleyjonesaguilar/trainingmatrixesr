import { useState } from 'react';
import { api } from '../api';
import esrLogo from '../assets/brand/esr-logo-full.png';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Set once a password check succeeds for an account with MFA enabled - switches the form to
  // the code-entry step instead of logging in immediately.
  const [mfaToken, setMfaToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = await api.login(username.trim(), password);
      if (result.mfaRequired) {
        setMfaToken(result.mfaToken);
      } else {
        onLogin(result.username, result.role);
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
      onLogin(result.username, result.role);
    } catch (err) {
      setError(err.message || 'Verification failed.');
    } finally {
      setSubmitting(false);
    }
  };

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

        <button type="submit" disabled={submitting || !username || !password}>
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>

        <p className="login-footnote">Safety Training Matrix &mdash; authorized personnel only.</p>
      </form>
    </div>
  );
}
