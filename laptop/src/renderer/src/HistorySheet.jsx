import React, { useEffect, useMemo, useState } from 'react';

/* A handful of cards are quicker to scan than to filter, so the box only turns
   up once the grid is genuinely long enough to hunt through. */
const SEARCH_FROM = 7;

function fmtWhen(iso) {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

export default function HistorySheet({ onClose }) {
  const [entries, setEntries] = useState(null);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    window.neku.getHistory().then((res) => setEntries(res.ok ? res.data : []));
  }, []);

  /* Client and batch are the two things he'd remember about an old delivery.
     The file line is just the client name again plus bouncy.gif, so matching it
     would make every single card a hit for "bouncy". */
  const shown = useMemo(() => {
    if (!entries) return null;
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (en) =>
        en.clientName.toLowerCase().includes(q) ||
        (en.batchName || '').toLowerCase().includes(q)
    );
  }, [entries, query]);

  const searchable = Boolean(entries) && entries.length >= SEARCH_FROM;

  // keyed by the entry itself, not its position: filtering reshuffles the
  // indexes and the tick would drift onto somebody else's card
  async function copy(link, key) {
    await window.neku.copyText(link);
    setCopiedIdx(key);
    setTimeout(() => setCopiedIdx((c) => (c === key ? null : c)), 1600);
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet panel wide" onClick={(e) => e.stopPropagation()}>
        <h2>Delivery history</h2>
        {entries && entries.length === 0 && (
          <p className="lede">
            Nothing here yet. Every delivery you finish is saved automatically, with its
            Drive link, so an old client's link is always one click away.
          </p>
        )}
        {searchable && (
          <div className="history-search">
            <input
              autoFocus
              value={query}
              spellCheck={false}
              placeholder="Search by client or batch"
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="history-count">
              {query.trim()
                ? `${shown.length} of ${entries.length}`
                : `${entries.length} deliveries`}
            </span>
          </div>
        )}
        {shown && shown.length === 0 && entries.length > 0 && (
          <p className="aside">
            No delivery matches &ldquo;{query.trim()}&rdquo;.
          </p>
        )}
        {shown && shown.length > 0 && (
          <div className="history-grid">
            {shown.map((en, idx) => (
              <div key={`${en.deliveredAt}-${idx}`} className="history-card">
                <div className="history-thumb checker">
                  {en.thumb ? (
                    <img src={en.thumb} alt={`${en.clientName} sprite`} />
                  ) : (
                    <span className="history-nothumb">no preview</span>
                  )}
                </div>
                <div className="history-main">
                  <span className="fname">{en.clientName}</span>
                  <span className="fsize">
                    {en.batchName ? `${en.batchName} · ` : ''}
                    {fmtWhen(en.deliveredAt)}
                  </span>
                  <span className="fsize mono">{en.files}</span>
                </div>
                <div className="history-actions">
                  <button className="btn slim" onClick={() => copy(en.link, en.deliveredAt)}>
                    {copiedIdx === en.deliveredAt ? 'Copied ✓' : 'Copy link'}
                  </button>
                  <button className="btn slim" onClick={() => window.neku.openLink(en.link)}>
                    Open
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="btn-row">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
