import React, { useRef, useState } from 'react';

/* The steps name the actual files where it can, because watching
   "Aiko_sprite.png filed" stamp itself is the confirmation that the naming
   templates did what the preview promised. */
function stepsFor(stagedName, attachedName) {
  return [
    { id: 'folders', label: 'Project + client folder ready' },
    { id: 'sprite', label: stagedName ? `${stagedName} filed` : 'Artwork renamed & filed' },
    { id: 'gif', label: attachedName ? `${attachedName} uploaded` : 'Attachment uploaded' },
    { id: 'share', label: 'Sharing: anyone with the link' },
    { id: 'link', label: 'Link fetched' },
  ];
}

const extOf = (name) => {
  const dot = String(name || '').lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
};

const PREVIEWABLE = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

const deliveryCount = (n) => (n === 1 ? 'once' : `${n} times`);

function fmtSize(n) {
  if (!n) return '';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function PackingSlip({
  clientName,
  onClientName,
  folderExists,
  asRevision,
  onAsRevision,
  revisionName,
  clients,
  namePreview,
  projectName,
  attachedName,
  attachedExt,
  stagedName,
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
  const steps = stepsFor(stagedName, attachedName);
  const typed = clientName.trim().toLowerCase();
  const knownClient = typed
    ? (clients || []).find((c) => c.name.toLowerCase() === typed)
    : null;
  const previewable = Boolean(gif) && PREVIEWABLE.includes(extOf(gif.file.name));
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
          <div className="sealed-title">
            Packed for {r.folderName}
            {r.revisionName ? ` · ${r.revisionName}` : ''}
          </div>
          {r.projectName && (
            <div className="sealed-project">
              filed in {r.projectName}
              {r.revisionName ? `/${r.folderName}/${r.revisionName}` : ''}
            </div>
          )}
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
            Next delivery &rarr;
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="zone zone-right">
      {/* the project is named by the header chip and spelled out in the destination
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
          list="known-clients"
          autoComplete="off"
          onChange={(e) => onClientName(e.target.value)}
        />
        {/* names delivered to before, so a repeat client is picked, not retyped
            and misspelled */}
        <datalist id="known-clients">
          {(clients || []).map((c) => (
            <option key={c.name} value={c.name} />
          ))}
        </datalist>
        {knownClient && !folderExists && (
          <div className="note">
            Delivered to before: {deliveryCount(knownClient.deliveries)}
            {knownClient.lastProjectName ? `, last in ${knownClient.lastProjectName}` : ''}.
          </div>
        )}
        {namePreview && <div className="note mono">{namePreview}</div>}

        {/* The hit is either a typo or a revision and the app cannot know which,
            so it says what it found and offers both. Adding into the folder stays
            the default: it is what Neku has always done. */}
        {folderExists && (
          <div className="warnstrip">
            <div>
              A folder with this name already exists
              {folderExists.projectName ? ` in ${folderExists.projectName}` : ''}.
            </div>
            <div className="choice-row">
              <button
                type="button"
                className={`btn slim${asRevision ? '' : ' primary'}`}
                disabled={running}
                onClick={() => onAsRevision(false)}
              >
                Add into that folder
              </button>
              {revisionName && (
                <button
                  type="button"
                  className={`btn slim${asRevision ? ' primary' : ''}`}
                  disabled={running}
                  onClick={() => onAsRevision(true)}
                >
                  Deliver as {revisionName}
                </button>
              )}
            </div>
            <div className="hint-sub">
              {asRevision
                ? `Goes into a ${revisionName} folder inside it. The link you already sent this client keeps working and gains the new files.`
                : `Check the spelling if this is meant to be someone new. Delivering into ${projectName} anyway.`}
            </div>
          </div>
        )}
      </div>

      <div className="field">
        <label>{attachedExt ? `Attachment (${attachedExt})` : 'Attachment'}</label>
        {gif ? (
          <div className="gif-slot filled checker">
            {/* preview-before-upload is the requirement, so show the file where it
                can be shown and say what it is where it cannot */}
            {previewable ? (
              <img src={gif.url} alt="Attachment preview" />
            ) : (
              <div className="filekind">{(extOf(gif.file.name) || 'file').replace('.', '').toUpperCase()}</div>
            )}
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
            drag the file from Downloads here
            <span className="hint-sub">
              or click to browse{attachedName ? ` (it becomes ${attachedName})` : ''}
            </span>
          </button>
        )}
        <input
          ref={gifInput}
          type="file"
          accept={attachedExt || undefined}
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
            ? asRevision && revisionName
              ? `Deliver ${revisionName} to Drive`
              : 'Deliver to Drive'
            : !selection
              ? 'Waiting for the artwork…'
              : !clientName.trim()
                ? 'Name the client first'
                : 'Add the attachment to deliver'}
        </button>
      )}

      {running && (
        <div className="steps">
          {steps.map((s) => {
            const idx = steps.findIndex((x) => x.id === delivery.step);
            const mine = steps.findIndex((x) => x.id === s.id);
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
