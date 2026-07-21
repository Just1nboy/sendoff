import React, { useEffect, useState } from 'react';

export default function SettingsSheet({ state, onClose, onChanged }) {
  const [form, setForm] = useState({ ...state.settings });
  const [error, setError] = useState(null);
  const [watch, setWatch] = useState(null); // { folder, active }
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  // "why didn't the gif notice appear" should be answerable by looking, not guessing
  useEffect(() => {
    window.neku.getGifWatchInfo().then((res) => {
      if (res.ok) setWatch(res.data);
    });
  }, []);

  async function save() {
    const res = await window.neku.saveSettings(form);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onChanged();
    onClose();
  }

  async function disconnect() {
    await window.neku.logout();
    onChanged();
    onClose();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet panel" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <div className="field">
          <label htmlFor="s-cid">OAuth client id</label>
          <input id="s-cid" value={form.clientId} spellCheck={false} onChange={set('clientId')} />
        </div>
        <div className="field">
          <label htmlFor="s-sec">OAuth client secret</label>
          <input
            id="s-sec"
            value={form.clientSecret}
            spellCheck={false}
            onChange={set('clientSecret')}
          />
        </div>
        <div className="field">
          <label htmlFor="s-staging">Staging folder</label>
          <input
            id="s-staging"
            value={form.stagingName}
            spellCheck={false}
            onChange={set('stagingName')}
          />
          <div className="note">Must match the tablet app's staging folder name exactly.</div>
        </div>
        <div className="field">
          <label htmlFor="s-root">Client folders live under</label>
          <input id="s-root" value={form.rootName} spellCheck={false} onChange={set('rootName')} />
        </div>
        {watch && (
          <div className="field">
            <label>Watching for finished gifs</label>
            <div className="note mono" title={watch.folder}>
              {watch.active ? watch.folder : `${watch.folder} (not being watched)`}
            </div>
            <div className="note">
              When a .gif finishes downloading here, Neku offers it in the corner of the
              screen. Dragging one onto the window always works too.
            </div>
          </div>
        )}
        {error && <div className="errbox">{error}</div>}
        <div className="btn-row">
          <button className="btn primary" onClick={save}>
            Save
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
        {!state.mock && state.loggedIn && (
          <div className="danger-line">
            Connected to Google Drive. <button onClick={disconnect}>Disconnect</button>
          </div>
        )}
      </div>
    </div>
  );
}
