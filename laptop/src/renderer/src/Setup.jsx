import React, { useState } from 'react';

export default function Setup({ onSaved }) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!clientId.trim() || !clientSecret.trim()) {
      setError('Both fields are needed. They come from the Google Cloud console.');
      return;
    }
    setSaving(true);
    setError(null);
    const res = await window.neku.saveSettings({
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
    });
    setSaving(false);
    if (!res.ok) setError(res.message);
    else onSaved();
  }

  return (
    <main className="centered-col">
      <div className="panel" style={{ width: 'min(92vw, 520px)' }}>
        <h2>One-time setup</h2>
        <p className="lede">
          This build wasn&rsquo;t pre-configured. If someone set Neku up for you, ask them
          for a ready-made build (or a <code>neku.config.json</code> to put next to the
          exe). Setting it up yourself? Paste the <strong>Desktop app</strong> OAuth client
          from the Google Cloud project (see <code>SETUP.md</code>). Stays on this computer.
        </p>
        <div className="field">
          <label htmlFor="clientId">OAuth client id</label>
          <input
            id="clientId"
            value={clientId}
            spellCheck={false}
            placeholder="1234567890-xxxx.apps.googleusercontent.com"
            onChange={(e) => setClientId(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="clientSecret">OAuth client secret</label>
          <input
            id="clientSecret"
            value={clientSecret}
            spellCheck={false}
            placeholder="GOCSPX-…"
            onChange={(e) => setClientSecret(e.target.value)}
          />
        </div>
        {error && <div className="errbox">{error}</div>}
        <button className="btn primary big" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save & connect Drive'}
        </button>
      </div>
    </main>
  );
}
