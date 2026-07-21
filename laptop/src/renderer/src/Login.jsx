import React, { useState } from 'react';

export default function Login({ onLoggedIn }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function connect() {
    setBusy(true);
    setError(null);
    const res = await window.neku.login();
    setBusy(false);
    if (!res.ok) setError(res.message);
    else onLoggedIn();
  }

  return (
    <main className="centered-col">
      <div className="panel" style={{ width: 'min(92vw, 460px)', textAlign: 'center' }}>
        <h2>Connect Google Drive</h2>
        <p className="lede">
          A browser tab opens for the Google sign-in. Use the Google account whose Drive
          should hold the commissions. First time through, Google shows an
          &ldquo;unverified app&rdquo; warning: click <strong>Advanced &rarr; Continue</strong>.
          That&rsquo;s expected, since Neku is a private app, not a store-published one.
        </p>
        {busy ? (
          <div className="login-wait">
            <div className="spin" />
            <span>Waiting for the browser sign-in&hellip;</span>
          </div>
        ) : (
          <button className="btn primary big" onClick={connect}>
            Connect Drive
          </button>
        )}
        {error && <div className="errbox">{error}</div>}
      </div>
    </main>
  );
}
