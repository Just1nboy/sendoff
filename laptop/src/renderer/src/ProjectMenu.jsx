/* The first screen of a working session: which project is this delivery going into?
   Three ways out, matching how he actually works:
     - carry on with a project that already exists (pick a row)
     - start the next project (the primary button)
     - anything already delivered stays where it is; projects are never merged */
import React, { useCallback, useEffect, useState } from 'react';

function fmtStarted(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const clientCount = (n) => (n === 1 ? '1 client' : `${n} clients`);

export default function ProjectMenu({ state, onPicked }) {
  const [list, setList] = useState(null); // { projects, nextNumber }
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await window.neku.listProjects();
    if (res.ok) setList(res.data);
    else setError(res.message);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const open = useCallback(
    async (project) => {
      setBusy(true);
      setError(null);
      const res = await window.neku.selectProject(project);
      setBusy(false);
      if (res.ok) onPicked();
      else setError(res.message);
    },
    [onPicked]
  );

  const startNew = useCallback(async () => {
    setBusy(true);
    setError(null);
    const res = await window.neku.createProject();
    setBusy(false);
    if (res.ok) await open(res.data);
    else setError(res.message);
  }, [open]);

  /* test hooks (mock mode only, used by npm run shots) */
  useEffect(() => {
    if (!state.mock) return undefined;
    window.__nekuProjectTest = {
      startNew,
      open,
      count: () => (list ? list.projects.length : -1),
    };
    return undefined;
  });

  // the name comes back with the listing: main owns the templates, not this screen
  const nextName = (list && list.nextName) || '…';

  return (
    <main className="centered-col">
      <div className="panel project-menu" style={{ width: 'min(92vw, 560px)' }}>
        <h2>Which project?</h2>
        <p className="lede">
          Every client folder lands inside a project, so{' '}
          <code>
            {state.settings.rootName}/{nextName}/Aiko
          </code>
          . Carry on with a project you already started, or open a new one.
        </p>

        {!list && !error && (
          <div className="login-wait">
            <span className="spin" />
            Reading your Drive…
          </div>
        )}

        {list && list.projects.length > 0 && (
          <div className="project-list">
            {list.projects.map((b) => (
              <button
                key={b.id}
                className="project-row"
                disabled={busy}
                onClick={() => open(b)}
              >
                <span className="fname">{b.name}</span>
                <span className="fsize">{clientCount(b.clients)}</span>
                <span className="fsize project-when">{fmtStarted(b.createdTime)}</span>
              </button>
            ))}
          </div>
        )}

        {list && list.projects.length === 0 && (
          <p className="aside">No projects yet. The first one starts here.</p>
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
