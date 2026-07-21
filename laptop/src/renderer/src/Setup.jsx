/* First run, for someone Justin has never met.

   Two questions, in the order that matters: where deliveries go, and what you
   deliver. Everything else has a working default, and a build that shipped with
   credentials never gets here at all — the person who packaged it already
   answered both. */
import React, { useState } from 'react';
import { PRESETS, applyTemplate, projectFolderName, templateVars } from '../../main/naming.mjs';

function examplePath(naming, rootName) {
  try {
    const number = naming.firstProjectNumber;
    const project = projectFolderName(naming.projectTemplate, number);
    const vars = (fileName) =>
      templateVars({ clientName: 'Aiko', projectName: project, projectNumber: number, fileName });
    return `${rootName}/${project}/Aiko/${applyTemplate(naming.stagedTemplate, vars('sketch.png'))}`;
  } catch {
    return null;
  }
}

export default function Setup({ onSaved }) {
  const [step, setStep] = useState(1);
  const [storage, setStorage] = useState(null); // 'local' | 'drive'
  const [localRoot, setLocalRoot] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const preset = PRESETS.find((p) => p.id === presetId) || PRESETS[0];

  async function chooseFolder() {
    setError(null);
    const res = await window.neku.pickFolder();
    if (res.ok && !res.data.canceled) setLocalRoot(res.data.path);
  }

  const canLeaveStep1 =
    storage === 'local' ? Boolean(localRoot) : Boolean(clientId.trim() && clientSecret.trim());

  async function finish() {
    setSaving(true);
    setError(null);
    const res = await window.neku.saveSettings({
      storage,
      localRoot: storage === 'local' ? localRoot : '',
      clientId: storage === 'drive' ? clientId.trim() : '',
      clientSecret: storage === 'drive' ? clientSecret.trim() : '',
      naming: preset.naming,
    });
    setSaving(false);
    if (!res.ok) setError(res.message);
    else onSaved();
  }

  return (
    <main className="centered-col">
      <div className="panel" style={{ width: 'min(92vw, 560px)' }}>
        <div className="wizard-steps">
          <span className={step === 1 ? 'on' : ''}>1 · Where deliveries go</span>
          <span className={step === 2 ? 'on' : ''}>2 · What you deliver</span>
        </div>

        {step === 1 && (
          <>
            <h2>Where should deliveries go?</h2>
            <p className="lede">
              Neku renames your files and files them into a folder per client. This is where
              that folder tree lives.
            </p>

            <button
              type="button"
              className={`choice-card${storage === 'local' ? ' on' : ''}`}
              onClick={() => setStorage('local')}
            >
              <span className="choice-title">A folder on this computer</span>
              <span className="choice-sub">
                Nothing to sign in to. Point it at a synced folder (Drive, Dropbox, OneDrive)
                and it is shareable by whatever already syncs it.
              </span>
            </button>

            <button
              type="button"
              className={`choice-card${storage === 'drive' ? ' on' : ''}`}
              onClick={() => setStorage('drive')}
            >
              <span className="choice-title">Google Drive</span>
              <span className="choice-sub">
                Each client folder is shared automatically and you get a link to send. Needs a
                one-time Google Cloud setup: see SETUP.md.
              </span>
            </button>

            {storage === 'local' && (
              <div className="field">
                <label>Delivery folder</label>
                <div className="btn-row">
                  <button className="btn" onClick={chooseFolder}>
                    {localRoot ? 'Choose a different folder' : 'Choose folder…'}
                  </button>
                </div>
                {localRoot && (
                  <div className="note mono" title={localRoot}>
                    {localRoot}
                  </div>
                )}
              </div>
            )}

            {storage === 'drive' && (
              <>
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
                  <div className="note">
                    From the <strong>Desktop app</strong> client in your Google Cloud project.
                    Stays on this computer.
                  </div>
                </div>
              </>
            )}

            {error && <div className="errbox">{error}</div>}
            <button
              className="btn primary big"
              onClick={() => setStep(2)}
              disabled={!storage || !canLeaveStep1}
            >
              {!storage
                ? 'Pick one to continue'
                : canLeaveStep1
                  ? 'Next'
                  : storage === 'local'
                    ? 'Choose a folder to continue'
                    : 'Both fields are needed'}
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <h2>What do you deliver?</h2>
            <p className="lede">
              This only sets the naming to start from. Every part of it is editable later in
              settings, and nothing here is permanent.
            </p>

            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`choice-card${presetId === p.id ? ' on' : ''}`}
                onClick={() => setPresetId(p.id)}
              >
                <span className="choice-title">{p.name}</span>
                <span className="choice-sub">{p.hint}</span>
              </button>
            ))}

            <div className="field">
              <label>A delivery would look like</label>
              <div className="note mono">
                {examplePath(preset.naming, storage === 'local' ? localRoot || 'your folder' : 'Commissions')}
              </div>
            </div>

            {error && <div className="errbox">{error}</div>}
            <div className="btn-row">
              <button className="btn" onClick={() => setStep(1)} disabled={saving}>
                Back
              </button>
              <button className="btn primary" onClick={finish} disabled={saving}>
                {saving ? 'Saving…' : storage === 'local' ? 'Start using Neku' : 'Save & connect Drive'}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
