import React, { useCallback, useEffect, useState } from 'react';
import Setup from './Setup.jsx';
import Login from './Login.jsx';
import BatchMenu from './BatchMenu.jsx';
import Workbench from './Workbench.jsx';
import SettingsSheet from './SettingsSheet.jsx';
import HistorySheet from './HistorySheet.jsx';

export default function App() {
  const [state, setState] = useState(null); // { mock, configured, loggedIn, settings }
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [bootError, setBootError] = useState(null);

  const refreshState = useCallback(async () => {
    const res = await window.neku.getState();
    if (res.ok) setState(res.data);
    else setBootError(res.message);
    return res;
  }, []);

  useEffect(() => {
    refreshState();
  }, [refreshState]);

  if (bootError) {
    return (
      <div className="fullscreen-status">
        <div className="alarm-ring">!</div>
        <p>{bootError}</p>
      </div>
    );
  }
  if (!state) return <div className="fullscreen-status" />;

  let body;
  if (!state.configured) {
    body = <Setup onSaved={refreshState} />;
  } else if (!state.loggedIn) {
    body = <Login settings={state.settings} onLoggedIn={refreshState} />;
  } else if (!state.batch) {
    body = <BatchMenu state={state} onPicked={refreshState} />;
  } else {
    body = <Workbench state={state} onAuthLost={refreshState} />;
  }

  return (
    <div className="app">
      <header className="bar">
        <div>
          <span className="mark">NEKU</span>
          <span className="route">
            {state.mock ? 'mock drive: nothing real is uploaded' : 'drive · commission runs'}
          </span>
        </div>
        <div className="spacer" />
        {state.batch && (
          <button
            className="btn slim batch-chip"
            title="Switch batch"
            onClick={async () => {
              await window.neku.leaveBatch();
              refreshState();
            }}
          >
            {state.batch.name}
            <span className="batch-chip-caret">&#9662;</span>
          </button>
        )}
        <button className="btn slim ghost" onClick={() => setHistoryOpen(true)}>
          history
        </button>
        <span
          className={
            'status-dot ' + (state.mock ? 'dot-mock' : state.loggedIn ? 'dot-on' : 'dot-off')
          }
          title={state.mock ? 'Mock mode' : state.loggedIn ? 'Connected' : 'Not connected'}
        />
        <button
          className="iconbtn"
          aria-label="Settings"
          onClick={() => setSettingsOpen(true)}
        >
          &#9881;
        </button>
      </header>

      {body}

      {settingsOpen && (
        <SettingsSheet
          state={state}
          onClose={() => setSettingsOpen(false)}
          onChanged={refreshState}
        />
      )}
      {historyOpen && <HistorySheet onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}
