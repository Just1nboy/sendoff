import React, { useCallback, useEffect, useState } from 'react';
import Setup from './Setup.jsx';
import Login from './Login.jsx';
import ProjectMenu from './ProjectMenu.jsx';
import Workbench from './Workbench.jsx';
import SettingsSheet from './SettingsSheet.jsx';
import HistorySheet from './HistorySheet.jsx';

export default function App() {
  const [state, setState] = useState(null); // { mock, configured, loggedIn, settings }
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [bootError, setBootError] = useState(null);

  const refreshState = useCallback(async () => {
    const res = await window.sendoff.getState();
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
  } else if (!state.project) {
    body = <ProjectMenu state={state} onPicked={refreshState} />;
  } else {
    body = <Workbench state={state} onAuthLost={refreshState} />;
  }

  return (
    <div className="app">
      <header className="bar">
        <div>
          <span className="mark">SENDOFF</span>
          {/* what the app is actually writing to, so "did that really upload?"
              is answerable by looking up rather than by checking Drive */}
          <span className="route">
            {state.mock
              ? 'mock drive: nothing real is uploaded'
              : !state.configured
                ? ''
                : state.storage === 'local'
                  ? `local folder · ${state.settings.localRoot}`
                  : 'google drive · live deliveries'}
          </span>
        </div>
        <div className="spacer" />
        {state.project && (
          <button
            className="btn slim project-chip"
            title="Switch project"
            onClick={async () => {
              await window.sendoff.leaveProject();
              refreshState();
            }}
          >
            {state.project.name}
            <span className="project-chip-caret">&#9662;</span>
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
