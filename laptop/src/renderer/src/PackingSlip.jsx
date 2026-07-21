import React, { useRef, useState } from 'react';

const STEPS = [
  { id: 'folders', label: 'Batch + client folder ready' },
  { id: 'sprite', label: 'Sprite renamed & filed' },
  { id: 'gif', label: 'bouncy.gif uploaded' },
  { id: 'share', label: 'Sharing: anyone with the link' },
  { id: 'link', label: 'Link fetched' },
];

function fmtSize(n) {
  if (!n) return '';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function PackingSlip({
  clientName,
  onClientName,
  folderExists,
  namePreview,
  batchName,
  gif,
  onGif,
  foundGif,
  onUseFoundGif,
  dropFlash,
  selection,
  canDeliver,
  delivery,
  onDeliver,
  onRetry,
  onReconnect,
  onNext,
}) {
  const gifInput = useRef(null);
  const [copied, setCopied] = useState(false);
  const running = delivery && delivery.phase === 'run';
  // the corner notice is the main offer; this is the quiet second chance for
  // when it timed out while he was still animating
  const offerFound = Boolean(foundGif) && (!gif || gif.file.name !== foundGif.name);
  const done = delivery && delivery.phase === 'done';
  const failed = delivery && delivery.phase === 'error';

  async function copyLink() {
    await window.neku.copyText(delivery.result.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  if (done) {
    const r = delivery.result;
    return (
      <section className="zone zone-right">
        <div className="zone-head">
          <span className="drawer-label">Sealed</span>
        </div>
        <div className="sealed">
          <div className="stamp-ring">&#10003;</div>
          <div className="sealed-title">Packed for {r.folderName}</div>
          {r.batchName && <div className="sealed-batch">filed in {r.batchName}</div>}
          <div className="sealed-files">
            {r.spriteName} + {r.gifName}
          </div>
          {r.notices.map((n) => (
            <div key={n} className="warnstrip">
              {n}
            </div>
          ))}
          <div className="linkbox">
            <span className="linktext">{r.link}</span>
          </div>
          <div className="btn-row">
            <button className="btn primary" onClick={copyLink}>
              {copied ? 'Copied ✓' : 'Copy link'}
            </button>
            <button className="btn" onClick={() => window.neku.openLink(r.link)}>
              Open in Drive
            </button>
          </div>
          <button className="btn ghost" onClick={onNext}>
            Next commission &rarr;
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="zone zone-right">
      {/* the batch is named by the header chip and spelled out in the destination
          line below, so the slip itself stays quiet about it */}
      <div className="zone-head">
        <span className="drawer-label">Packing slip</span>
      </div>

      <div className="field">
        <label htmlFor="client">Client name</label>
        <input
          id="client"
          value={clientName}
          spellCheck={false}
          placeholder="the client this goes to"
          disabled={running}
          onChange={(e) => onClientName(e.target.value)}
        />
        {namePreview && <div className="note mono">{namePreview}</div>}
        {folderExists && (
          <div className="warnstrip">
            A folder with this name already exists
            {folderExists.batchName ? ` in ${folderExists.batchName}` : ''}. Repeat clients
            aren&rsquo;t a thing, so double-check the spelling. Delivering this one into{' '}
            {batchName} anyway.
          </div>
        )}
      </div>

      <div className="field">
        <label>Animation</label>
        {gif ? (
          <div className="gif-slot filled checker">
            <img src={gif.url} alt="Gif preview" />
            <div className="filecard">
              <span className="fname">{gif.file.name}</span>
              <span className="fsize">{fmtSize(gif.file.size)}</span>
            </div>
            {!running && (
              <button className="btn slim swap" onClick={() => gifInput.current.click()}>
                swap
              </button>
            )}
          </div>
        ) : (
          <button
            className="gif-slot"
            onClick={() => gifInput.current.click()}
            disabled={running}
          >
            drag the gif from Downloads here
            <span className="hint-sub">or click to browse (it becomes bouncy.gif)</span>
          </button>
        )}
        <input
          ref={gifInput}
          type="file"
          accept=".gif,image/gif"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files && e.target.files[0];
            if (f) onGif(f);
            e.target.value = '';
          }}
        />
        {offerFound && (
          <button className="foundgif" onClick={onUseFoundGif} disabled={running}>
            <span className="foundgif-tag">just downloaded</span>
            <span className="fname">{foundGif.name}</span>
            <span className="fsize">{fmtSize(foundGif.size)}</span>
            <span className="foundgif-go">{gif ? 'use instead' : 'use it'} &rarr;</span>
          </button>
        )}
        {dropFlash && <div className="errbox">{dropFlash}</div>}
      </div>

      {!running && !failed && (
        <button className="btn primary big" onClick={onDeliver} disabled={!canDeliver}>
          {canDeliver
            ? 'Deliver to Drive'
            : !selection
              ? 'Waiting for a sprite…'
              : !clientName.trim()
                ? 'Name the client first'
                : 'Add the gif to deliver'}
        </button>
      )}

      {running && (
        <div className="steps">
          {STEPS.map((s) => {
            const idx = STEPS.findIndex((x) => x.id === delivery.step);
            const mine = STEPS.findIndex((x) => x.id === s.id);
            const state = mine < idx ? 'done' : mine === idx ? 'active' : 'todo';
            return (
              <div key={s.id} className={`step ${state}`}>
                <span className="step-mark">
                  {state === 'done' ? '✓' : state === 'active' ? '●' : '○'}
                </span>
                {s.label}
              </div>
            );
          })}
        </div>
      )}

      {failed && (
        <div className="failbox">
          <div className="errbox">{delivery.message}</div>
          <div className="btn-row">
            {delivery.authExpired ? (
              <button className="btn primary" onClick={onReconnect}>
                Reconnect Google
              </button>
            ) : (
              <button className="btn primary" onClick={onRetry}>
                Retry
              </button>
            )}
            <button className="btn" onClick={onNext}>
              Start over
            </button>
          </div>
          <p className="aside">
            Retrying is safe. Finished steps are detected and not repeated. Your typed name and
            gif are still here.
          </p>
        </div>
      )}
    </section>
  );
}
