import React, { useEffect, useMemo, useState } from 'react';
import {
  PRESETS,
  TOKENS,
  applyTemplate,
  matchPreset,
  projectFolderName,
  resolveNaming,
  templateVars,
  validateNaming,
} from '../../main/naming.mjs';

/* A live example of what the current templates produce. This is the whole point
   of the settings screen: nobody should have to deliver a real commission to
   find out what their own naming rules do. */
function preview(naming) {
  try {
    const number = naming.firstProjectNumber;
    const projectName = projectFolderName(naming.projectTemplate, number);
    const vars = (fileName) =>
      templateVars({ clientName: 'Aiko', projectName, projectNumber: number, fileName });
    return {
      project: projectName,
      staged: applyTemplate(naming.stagedTemplate, vars('sketch.png')),
      attached: applyTemplate(naming.attachedTemplate, vars('ezgif-4-b2a91c.gif')),
    };
  } catch {
    return null;
  }
}

export default function SettingsSheet({ state, onClose, onChanged }) {
  const [form, setForm] = useState({ ...state.settings });
  const [naming, setNaming] = useState(() => resolveNaming(state.settings.naming));
  const [error, setError] = useState(null);
  const [watch, setWatch] = useState(null); // { folder, active }
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const setName = (key) => (e) => setNaming({ ...naming, [key]: e.target.value });

  const errors = useMemo(() => validateNaming(naming) || {}, [naming]);
  const shown = useMemo(() => preview(resolveNaming(naming)), [naming]);
  const activePreset = matchPreset(naming);

  // "why didn't the gif notice appear" should be answerable by looking, not guessing
  useEffect(() => {
    window.sendoff.getGifWatchInfo().then((res) => {
      if (res.ok) setWatch(res.data);
    });
  }, []);

  async function save() {
    const res = await window.sendoff.saveSettings({ ...form, naming });
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onChanged();
    onClose();
  }

  async function chooseFolder() {
    const res = await window.sendoff.pickFolder();
    if (res.ok && !res.data.canceled) setForm({ ...form, localRoot: res.data.path });
  }

  async function disconnect() {
    await window.sendoff.logout();
    onChanged();
    onClose();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet panel" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <h3 className="sheet-section">What you deliver</h3>
        <div className="field">
          <label>Start from a preset</label>
          <div className="preset-row">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                title={p.hint}
                className={`btn slim${activePreset && activePreset.id === p.id ? ' primary' : ''}`}
                onClick={() => setNaming(resolveNaming(p.naming))}
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className="note">
            {activePreset
              ? activePreset.hint
              : 'Edited from a preset. Everything below is yours to change.'}
          </div>
        </div>

        <div className="field">
          <label htmlFor="s-project">Project folder name</label>
          <input
            id="s-project"
            value={naming.projectTemplate}
            spellCheck={false}
            onChange={setName('projectTemplate')}
          />
          {errors.projectTemplate && <div className="errbox">{errors.projectTemplate}</div>}
        </div>

        <div className="field">
          <label htmlFor="s-first">Start numbering at</label>
          <input
            id="s-first"
            type="number"
            min="1"
            value={naming.firstProjectNumber}
            onChange={(e) => setNaming({ ...naming, firstProjectNumber: Number(e.target.value) })}
          />
          <div className="note">
            Only used before the first project exists. After that the number counts up from the
            highest one in Drive, and a deleted project never hands its number back.
          </div>
        </div>

        <div className="field">
          <label htmlFor="s-staged">Name for the file sent from your phone or tablet</label>
          <input
            id="s-staged"
            value={naming.stagedTemplate}
            spellCheck={false}
            onChange={setName('stagedTemplate')}
          />
          {errors.stagedTemplate && <div className="errbox">{errors.stagedTemplate}</div>}
        </div>

        <div className="field">
          <label htmlFor="s-attached">Name for the file you attach here</label>
          <input
            id="s-attached"
            value={naming.attachedTemplate}
            spellCheck={false}
            onChange={setName('attachedTemplate')}
          />
          {errors.attachedTemplate && <div className="errbox">{errors.attachedTemplate}</div>}
          <div className="note">
            A fixed name like <code>bouncy.gif</code> is fine: the per-client folder is what keeps
            deliveries apart, not the file name.
          </div>
        </div>

        <div className="field">
          <label htmlFor="s-revision">Name for a revision folder</label>
          <input
            id="s-revision"
            value={naming.revisionTemplate}
            spellCheck={false}
            onChange={setName('revisionTemplate')}
          />
          {errors.revisionTemplate && <div className="errbox">{errors.revisionTemplate}</div>}
          <div className="note">
            When you deliver to a client you have delivered to before, the new files can go in
            a subfolder of their existing folder. The link you already sent them keeps working
            and gains the new version. The first delivery is v1, so numbering starts at v2.
          </div>
        </div>

        <div className="field">
          <label>You can use</label>
          <div className="note token-list">
            {TOKENS.map((t) => (
              <span key={t.token} className="token" title={t.help}>
                <code>{t.token}</code> {t.help}
              </span>
            ))}
          </div>
        </div>

        {shown && (
          <div className="field">
            <label>A delivery to a client called Aiko would be</label>
            <div className="note mono">
              {form.rootName}/{shown.project}/Aiko/
              <br />
              &nbsp;&nbsp;{shown.staged}
              <br />
              &nbsp;&nbsp;{shown.attached}
            </div>
          </div>
        )}

        <h3 className="sheet-section">Where it goes</h3>
        <div className="field">
          <label>Deliveries land in</label>
          <div className="preset-row">
            <button
              type="button"
              className={`btn slim${form.storage === 'local' ? ' primary' : ''}`}
              onClick={() => setForm({ ...form, storage: 'local' })}
            >
              A folder on this computer
            </button>
            <button
              type="button"
              className={`btn slim${form.storage === 'drive' ? ' primary' : ''}`}
              onClick={() => setForm({ ...form, storage: 'drive' })}
            >
              Google Drive
            </button>
          </div>
          {form.storage === 'local' && (
            <>
              <div className="btn-row" style={{ marginTop: 8 }}>
                <button className="btn slim" onClick={chooseFolder}>
                  {form.localRoot ? 'Change folder' : 'Choose folder…'}
                </button>
              </div>
              <div className="note mono" title={form.localRoot}>
                {form.localRoot || 'No folder chosen yet.'}
              </div>
              <div className="note">
                Nothing is shared automatically: a folder on this computer has no link. Sendoff
                offers to open the folder instead.
              </div>
            </>
          )}
        </div>
        <div className="field">
          <label htmlFor="s-staging">Staging folder</label>
          <input
            id="s-staging"
            value={form.stagingName}
            spellCheck={false}
            onChange={set('stagingName')}
          />
          <div className="note">Must match the tablet app&rsquo;s staging folder name exactly.</div>
        </div>
        <div className="field">
          <label htmlFor="s-root">Client folders live under</label>
          <input id="s-root" value={form.rootName} spellCheck={false} onChange={set('rootName')} />
        </div>
        {watch && (
          <div className="field">
            <label>Watching for finished files</label>
            <div className="note mono" title={watch.folder}>
              {watch.active ? watch.folder : `${watch.folder} (not being watched)`}
            </div>
            <div className="note">
              When a file finishes downloading here, Sendoff offers it in the corner of the screen.
              Dragging one onto the window always works too.
            </div>
          </div>
        )}

        <h3 className="sheet-section">Google account</h3>
        {form.storage === 'local' && (
          <div className="note" style={{ marginBottom: 10 }}>
            Not used while deliveries go to a folder on this computer.
          </div>
        )}
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

        {error && <div className="errbox">{error}</div>}
        <div className="btn-row">
          <button
            className="btn primary"
            onClick={save}
            disabled={Object.keys(errors).length > 0}
          >
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
