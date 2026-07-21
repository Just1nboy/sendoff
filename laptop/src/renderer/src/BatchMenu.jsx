/* The first screen of a working session: which batch is this sprite going into?
   Three ways out, matching how he actually works:
     - carry on with a batch that already exists (pick a row)
     - start the next batch (the primary button)
     - anything already delivered stays where it is; batches are never merged */
import React, { useCallback, useEffect, useState } from 'react';
import { batchFolderName } from '../../main/naming.mjs';

function fmtStarted(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const clientCount = (n) => (n === 1 ? '1 client' : `${n} clients`);

export default function BatchMenu({ state, onPicked }) {
  const [list, setList] = useState(null); // { batches, nextNumber }
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await window.neku.listBatches();
    if (res.ok) setList(res.data);
    else setError(res.message);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const open = useCallback(
    async (batch) => {
      setBusy(true);
      setError(null);
      const res = await window.neku.selectBatch(batch);
      setBusy(false);
      if (res.ok) onPicked();
      else setError(res.message);
    },
    [onPicked]
  );

  const startNew = useCallback(async () => {
    setBusy(true);
    setError(null);
    const res = await window.neku.createBatch();
    setBusy(false);
    if (res.ok) await open(res.data);
    else setError(res.message);
  }, [open]);

  /* test hooks (mock mode only, used by npm run shots) */
  useEffect(() => {
    if (!state.mock) return undefined;
    window.__nekuBatchTest = {
      startNew,
      open,
      count: () => (list ? list.batches.length : -1),
    };
    return undefined;
  });

  const nextName = batchFolderName(list ? list.nextNumber : 1);

  return (
    <main className="centered-col">
      <div className="panel batch-menu" style={{ width: 'min(92vw, 560px)' }}>
        <h2>Which batch?</h2>
        <p className="lede">
          Every client folder lands inside a batch, so{' '}
          <code>
            {state.settings.rootName}/{nextName}/Aiko
          </code>
          . Carry on with a batch you already started, or open a new one.
        </p>

        {!list && !error && (
          <div className="login-wait">
            <span className="spin" />
            Reading your Drive…
          </div>
        )}

        {list && list.batches.length > 0 && (
          <div className="batch-list">
            {list.batches.map((b) => (
              <button
                key={b.id}
                className="batch-row"
                disabled={busy}
                onClick={() => open(b)}
              >
                <span className="fname">{b.name}</span>
                <span className="fsize">{clientCount(b.clients)}</span>
                <span className="fsize batch-when">{fmtStarted(b.createdTime)}</span>
              </button>
            ))}
          </div>
        )}

        {list && list.batches.length === 0 && (
          <p className="aside">No batches yet. The first one starts here.</p>
        )}

        {error && (
          <div className="failbox">
            <div className="errbox">{error}</div>
            <button className="btn" onClick={load}>
              Try again
            </button>
          </div>
        )}

        <button className="btn primary big" onClick={startNew} disabled={busy || !list}>
          {busy ? 'Working…' : `Start ${nextName}`}
        </button>
      </div>
    </main>
  );
}
