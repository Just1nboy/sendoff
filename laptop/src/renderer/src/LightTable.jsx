import React, { useEffect, useRef, useState } from 'react';

function fmtAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
}

function fmtSize(size) {
  const n = Number(size);
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function LightTable({
  staging,
  selection,
  suggestedName,
  onSelect,
  onRefresh,
  onDiscard,
  onLocalSprite,
  onReconnect,
  previewCache,
  busy,
}) {
  const fileInput = useRef(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saved, setSaved] = useState(null); // null | {path} | {error}
  const [saving, setSaving] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [discardError, setDiscardError] = useState(null);
  const localUrlRef = useRef(null);

  // resolve a preview image for whatever is selected
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!selection) {
        setPreviewUrl(null);
        return;
      }
      if (selection.kind === 'local') {
        if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
        localUrlRef.current = URL.createObjectURL(selection.file);
        setPreviewUrl(localUrlRef.current);
        return;
      }
      const cached = previewCache.current.get(selection.id);
      if (cached) {
        setPreviewUrl(cached);
        return;
      }
      setPreviewLoading(true);
      setPreviewUrl(null);
      const res = await window.neku.getFileBytes(selection.id);
      if (cancelled) return;
      setPreviewLoading(false);
      if (res.ok) {
        const url = URL.createObjectURL(new Blob([new Uint8Array(res.data)], { type: 'image/png' }));
        previewCache.current.set(selection.id, url);
        setPreviewUrl(url);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [selection, previewCache]);

  useEffect(
    () => () => {
      if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
    },
    []
  );

  // a "saved to..." line only makes sense for the sprite it was about, and a
  // half-answered "remove this?" must not carry over to a different sprite
  useEffect(() => {
    setSaved(null);
    setConfirmingDiscard(false);
    setDiscardError(null);
  }, [selection]);

  async function discard() {
    setDiscarding(true);
    setDiscardError(null);
    const message = await onDiscard();
    setDiscarding(false);
    if (message) setDiscardError(message);
    else setConfirmingDiscard(false);
  }

  /* Copy the sprite onto this machine so he can animate it. The bytes come
     from Drive in the main process, so a preview that never loaded is fine. */
  async function saveSprite() {
    if (!selection) return;
    setSaving(true);
    setSaved(null);
    try {
      const name = suggestedName || selection.name;
      const payload =
        selection.kind === 'drive'
          ? { kind: 'drive', id: selection.id, name }
          : { kind: 'local', name, bytes: new Uint8Array(await selection.file.arrayBuffer()) };
      const res = await window.neku.saveSprite(payload);
      if (!res.ok) setSaved({ error: res.message });
      else if (!res.data.canceled) setSaved({ path: res.data.path });
    } catch (err) {
      setSaved({ error: String(err.message || err) });
    } finally {
      setSaving(false);
    }
  }

  const files = staging.files;
  const selectedMeta =
    selection && selection.kind === 'drive' ? files.find((f) => f.id === selection.id) : null;

  return (
    <section className="zone zone-left">
      <div className="zone-head">
        <span className="drawer-label">Light table</span>
        <span className="spacer" />
        <button className="iconbtn small" onClick={onRefresh} title="Check staging now" disabled={busy}>
          &#8635;
        </button>
      </div>

      {staging.error && (
        <div className="errstrip">
          <span>{staging.error}</span>
          {staging.authLost ? (
            <button className="btn slim" onClick={onReconnect}>
              Reconnect
            </button>
          ) : (
            <button className="btn slim" onClick={onRefresh}>
              Retry
            </button>
          )}
        </div>
      )}

      {files.length > 1 && (
        <div className="warnstrip">
          {files.length} sprites are waiting. Pick the one for this commission.
        </div>
      )}

      {/* the checkerboard means "transparency", so it only belongs behind an actual sprite */}
      <div className={'table' + (selection ? ' checker' : '')}>
        {selection && previewUrl && (
          <img className="sprite" src={previewUrl} alt="Sprite preview" />
        )}
        {selection && previewLoading && <div className="spin" />}

        {/* wrong image off the tablet: take it off the table without having to
            go to Drive. Two steps, because the right sprite is one click away. */}
        {selection && !busy && !confirmingDiscard && (
          <button
            className="iconbtn small discard-x"
            title="Remove this sprite"
            aria-label="Remove this sprite"
            onClick={() => setConfirmingDiscard(true)}
          >
            &#10005;
          </button>
        )}
        {selection && confirmingDiscard && (
          <div className="discard-confirm">
            <div className="discard-ask">Remove this sprite?</div>
            <div className="hint-sub">
              {selection.kind === 'local'
                ? 'It is only picked here, so nothing in Drive changes.'
                : 'It goes to your Drive trash, so it can be got back.'}
            </div>
            {discardError && <div className="errbox">{discardError}</div>}
            <div className="btn-row">
              <button className="btn slim" onClick={discard} disabled={discarding}>
                {discarding ? 'Removing…' : 'Remove'}
              </button>
              <button
                className="btn slim ghost"
                onClick={() => setConfirmingDiscard(false)}
                disabled={discarding}
              >
                Keep it
              </button>
            </div>
          </div>
        )}
        {selection && (
          <div className="filecard">
            <span className="fname">{selection.name}</span>
            {selectedMeta && (
              <span className="fsize">
                {fmtSize(selectedMeta.size)} · {fmtAgo(selectedMeta.modifiedTime)}
              </span>
            )}
            {selection.kind === 'local' && <span className="fsize">local file</span>}
          </div>
        )}
        {!selection && (
          <div className="empty-hint">
            {staging.loading ? (
              <div className="spin" />
            ) : files.length === 0 ? (
              <>
                <div>Waiting for a sprite from the tablet</div>
                <div className="hint-sub">
                  Draw, then hit Send on the tablet, and it lands here. Staging is checked every
                  15&nbsp;seconds.
                </div>
              </>
            ) : (
              <div>Pick a sprite from the list below</div>
            )}
          </div>
        )}
      </div>

      {files.length > 1 && (
        <div className="staged-list">
          {files.map((f) => {
            const active = selection && selection.kind === 'drive' && selection.id === f.id;
            return (
              <button
                key={f.id}
                className={'staged-row' + (active ? ' active' : '')}
                onClick={() => onSelect({ kind: 'drive', id: f.id, name: f.name })}
                disabled={busy}
              >
                <span className="fname">{f.name}</span>
                <span className="fsize">{fmtAgo(f.modifiedTime)}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="zone-foot">
        {saved && saved.path && (
          <div className="savedstrip">
            <span className="fname" title={saved.path}>
              Saved to {saved.path}
            </span>
            <button className="btn slim" onClick={() => window.neku.revealFile(saved.path)}>
              Show in folder
            </button>
          </div>
        )}
        {saved && saved.error && <div className="errstrip">{saved.error}</div>}
        <div className="foot-row">
          <button
            className="btn"
            onClick={saveSprite}
            disabled={!selection || busy || saving}
            title="Save this sprite as a .png on this computer"
          >
            {saving ? 'Saving…' : 'Save sprite to this computer'}
          </button>
          <button className="btn ghost" onClick={() => fileInput.current.click()} disabled={busy}>
            use a local .png instead
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".png,image/png"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files && e.target.files[0];
            if (f) onLocalSprite(f);
            e.target.value = '';
          }}
        />
      </div>
    </section>
  );
}
