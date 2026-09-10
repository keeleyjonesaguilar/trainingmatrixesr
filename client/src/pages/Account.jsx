import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Account({ username }) {
  const [mfaEnabled, setMfaEnabled] = useState(null); // null = still loading
  const [error, setError] = useState('');

  // Setup-in-progress state (QR shown, waiting for the user to confirm with a code).
  const [setupToken, setSetupToken] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [starting, setStarting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Shown exactly once, right after enabling.
  const [backupCodes, setBackupCodes] = useState(null);

  // Disable flow.
  const [disabling, setDisabling] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');

  const load = () => api.getMfaStatus().then((res) => setMfaEnabled(res.mfaEnabled)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const startSetup = async () => {
    setError('');
    setStarting(true);
    try {
      const res = await api.startMfaSetup();
      setSetupToken(res.setupToken);
      setQrDataUrl(res.qrDataUrl);
      setSecret(res.secret);
      setSetupCode('');
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  };

  const cancelSetup = () => {
    setSetupToken('');
    setQrDataUrl('');
    setSecret('');
    setSetupCode('');
  };

  const confirmSetup = async (e) => {
    e.preventDefault();
    setError('');
    setConfirming(true);
    try {
      const res = await api.enableMfa(setupToken, setupCode.trim());
      setBackupCodes(res.backupCodes);
      cancelSetup();
      setMfaEnabled(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setConfirming(false);
    }
  };

  const submitDisable = async (e) => {
    e.preventDefault();
    setError('');
    setDisabling(true);
    try {
      await api.disableMfa(disablePassword);
      setDisablePassword('');
      setMfaEnabled(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setDisabling(false);
    }
  };

  return (
    <div>
      <h1>My Account</h1>
      <p className="page-subtitle">Signed in as <strong>{username}</strong>.</p>
      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <h2>Two-Factor Authentication</h2>
        <p>
          Adds a second step at login (a 6-digit code from an authenticator app on your phone),
          on top of your password. Recommended for every account, especially Admin and Super Admin.
        </p>

        {backupCodes && (
          <div className="card" style={{ background: 'var(--color-warning-bg, #fff8e1)' }}>
            <h3>Save your backup codes</h3>
            <p>
              Two-factor authentication is now on. Each code below can be used once, in place of
              your authenticator app, if you ever lose access to your phone. Save these somewhere
              safe &mdash; they will not be shown again.
            </p>
            <pre style={{ fontFamily: 'monospace', fontSize: '1.05em' }}>{backupCodes.join('\n')}</pre>
            <button type="button" onClick={() => setBackupCodes(null)}>I&apos;ve saved these codes</button>
          </div>
        )}

        {mfaEnabled === null && <p>Loading...</p>}

        {mfaEnabled === true && !backupCodes && (
          <>
            <p><span className="badge badge-current">Two-Factor Authentication is ON</span></p>
            {!disabling ? (
              <button type="button" className="secondary" onClick={() => setDisabling(true)}>Turn off Two-Factor Authentication</button>
            ) : (
              <form onSubmit={submitDisable} className="toolbar">
                <input
                  type="password"
                  placeholder="Confirm your password"
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  autoFocus
                />
                <button type="submit" disabled={!disablePassword}>Confirm Turn Off</button>
                <button type="button" className="secondary" onClick={() => { setDisabling(false); setDisablePassword(''); }}>Cancel</button>
              </form>
            )}
          </>
        )}

        {mfaEnabled === false && !setupToken && !backupCodes && (
          <button type="button" onClick={startSetup} disabled={starting}>
            {starting ? 'Starting...' : 'Enable Two-Factor Authentication'}
          </button>
        )}

        {setupToken && (
          <div>
            <ol>
              <li>Scan this QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password, etc).</li>
              <li>Or enter this code manually: <code>{secret}</code></li>
              <li>Then enter the 6-digit code the app shows you below.</li>
            </ol>
            <img src={qrDataUrl} alt="Two-factor authentication QR code" width={200} height={200} />
            <form onSubmit={confirmSetup} className="toolbar">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                value={setupCode}
                onChange={(e) => setSetupCode(e.target.value)}
                autoFocus
              />
              <button type="submit" disabled={confirming || setupCode.length !== 6}>
                {confirming ? 'Confirming...' : 'Confirm & Enable'}
              </button>
              <button type="button" className="secondary" onClick={cancelSetup}>Cancel</button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
