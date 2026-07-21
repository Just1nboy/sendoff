import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GIF_FILE_NAME, cleanClientName, spriteFileName } from '../../main/naming.mjs';
import LightTable from './LightTable.jsx';
import PackingSlip from './PackingSlip.jsx';

const POLL_MS = 15000;
const THUMB_MAX = 128;

// the sprite as a blob, whether it came off the tablet or off this machine
async function spriteBlob(selection, previewCache) {
  if (selection.kind === 'local') return selection.file;
  const cached = previewCache.current.get(selection.id);
  if (cached) {
    try {
      return await (await fetch(cached)).blob();
    } catch {
      /* fall through to a fresh download */
    }
  }
  const res = await window.neku.getFileBytes(selection.id);
  if (!res.ok) return null;
  return new Blob([new Uint8Array(res.data)], { type: 'image/png' });
}

// a small png the history sheet can show, so an old delivery is recognisable at a glance
async function makeThumb(blob) {
  if (!blob) return null;
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, THUMB_MAX / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false; // pixel art must not go soft
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    return canvas.toDataURL('image/png');
  } catch {
    return null; // a missing thumbnail must never block a delivery
  }
}

export default function Workbench({ state }) {
  const [staging, setStaging] = useState({
    loading: true,
    stagingId: null,
    files: [],
    error: null,
    authLost: false,
  });
  const [selection, setSelection] = useState(null); // {kind:'drive',id,name}|{kind:'local',file,name}
  const [clientName, setClientName] = useState('');
  const [folderExists, setFolderExists] = useState(null); // null | { batchName }
  const [gif, setGif] = useState(null); // { file, url }
  const [foundGif, setFoundGif] = useState(null); // gif Neku saw land in Downloads
  const [delivery, setDelivery] = useState(null); // null|{phase:'run',step}|{phase:'done',result}|{phase:'error',...}
  const [dropFlash, setDropFlash] = useState(null);

  const deliveryRef = useRef(null);
  deliveryRef.current = delivery;
  const previewCache = useRef(new Map()); // drive file id -> object URL
  // ids seen in staging, so a genuinely new arrival can be told apart from the
  // ones that were already sitting there. null until the first listing lands:
  // everything in that first answer predates this session and is not news.
  const knownStaged = useRef(null);

  /* ---------- staging poll ---------- */

  const refreshStaging = useCallback(async (force = false) => {
    // deliveryRef mirrors state on render, so callers inside the deliver
    // flow itself must force past the poll guard
    if (!force && deliveryRef.current && deliveryRef.current.phase === 'run') return;
    const res = await window.neku.listStaging();
    if (!res.ok) {
      setStaging((s) => ({ ...s, loading: false, error: res.message, authLost: res.code === 'auth' }));
      return;
    }
    const { stagingId, files } = res.data;
    setStaging({ loading: false, stagingId, files, error: null, authLost: false });

    /* He sends from the tablet and then walks back to the laptop, or is already
       mid-animation on the previous commission. Either way he is not staring at
       the light table when it lands, so main raises the corner card. Files come
       back newest first. */
    const ids = files.map((f) => f.id);
    if (knownStaged.current === null) {
      knownStaged.current = new Set(ids);
    } else {
      const arrived = files.filter((f) => !knownStaged.current.has(f.id));
      knownStaged.current = new Set(ids);
      if (arrived.length > 0) window.neku.announceSprite(arrived[0]);
    }

    setSelection((sel) => {
      if (sel && sel.kind === 'drive' && !files.some((f) => f.id === sel.id)) return null;
      if (!sel && files.length === 1) {
        return { kind: 'drive', id: files[0].id, name: files[0].name };
      }
      return sel;
    });
  }, []);

  useEffect(() => {
    refreshStaging();
    const timer = setInterval(refreshStaging, POLL_MS);
    const onFocus = () => refreshStaging();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshStaging]);

  // object URLs die with the workbench
  useEffect(() => {
    const cache = previewCache.current;
    return () => {
      for (const url of cache.values()) URL.revokeObjectURL(url);
      cache.clear();
    };
  }, []);

  /* ---------- folder-exists check (typo guard: repeat clients don't happen) ----------
     Looks across every batch, not just this one: a name reused from an old batch
     is the likeliest kind of typo. */

  useEffect(() => {
    setFolderExists(null);
    const name = clientName.trim();
    if (!name) return undefined;
    const timer = setTimeout(async () => {
      const res = await window.neku.checkClientFolder(name);
      if (res.ok && res.data.exists) setFolderExists({ batchName: res.data.batchName });
    }, 600);
    return () => clearTimeout(timer);
  }, [clientName]);

  /* ---------- gif + local sprite intake ---------- */

  const attachGif = useCallback((file) => {
    if (!file.name.toLowerCase().endsWith('.gif')) {
      setDropFlash(`"${file.name}" is not a .gif`);
      return;
    }
    setGif((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return { file, url: URL.createObjectURL(file) };
    });
    setDropFlash(null);
  }, []);

  const attachLocalSprite = useCallback((file) => {
    setSelection({ kind: 'local', file, name: file.name });
    setDropFlash(null);
  }, []);

  /* ---------- the gif Neku spotted in Downloads ----------
     Main only hands over metadata, so the bytes are fetched at the moment he
     accepts. Wrapping them in a File keeps every downstream path (preview,
     swap, deliver) identical to a dragged one. */

  const useFoundGif = useCallback(
    async (info) => {
      if (!info) return;
      const res = await window.neku.readGif(info.path);
      if (!res.ok) {
        setFoundGif(null);
        setDropFlash(res.message);
        return;
      }
      attachGif(new File([res.data.bytes], res.data.name, { type: 'image/gif' }));
      setFoundGif(null);
    },
    [attachGif]
  );

  // an offer is pointless once a gif is in the slot, so main can skip the notice
  useEffect(() => {
    window.neku.setGifAttached(Boolean(gif));
  }, [gif]);

  useEffect(() => {
    // covers the gap between main spotting one and this listener existing
    window.neku.getLatestGif().then((res) => {
      if (res.ok && res.data) setFoundGif(res.data);
    });
    const offFound = window.neku.onGifFound((g) => setFoundGif(g));
    const offUse = window.neku.onGifUse((g) => useFoundGif(g));
    return () => {
      offFound();
      offUse();
    };
  }, [useFoundGif]);

  /* The wrong image came off the tablet. A local pick is only ever a choice in
     this window, so dropping it is enough; a staged one has to leave Drive or it
     sits on the light table forever. Returns an error string, or null. */
  const discardSprite = useCallback(async () => {
    if (!selection) return null;
    if (selection.kind === 'local') {
      setSelection(null);
      return null;
    }
    const res = await window.neku.discardStaged(selection.id);
    if (!res.ok) return res.message;
    setSelection(null);
    refreshStaging(true);
    return null;
  }, [selection, refreshStaging]);

  const routeDroppedFile = useCallback(
    (file) => {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.gif')) attachGif(file);
      else if (lower.endsWith('.png')) attachLocalSprite(file);
      else setDropFlash(`"${file.name}": expected a .png (sprite) or .gif (animation)`);
    },
    [attachGif, attachLocalSprite]
  );

  /* ---------- deliver ---------- */

  const nameOk = (() => {
    try {
      return Boolean(cleanClientName(clientName));
    } catch {
      return false;
    }
  })();
  const canDeliver =
    Boolean(selection) && nameOk && Boolean(gif) && (!delivery || delivery.phase !== 'run');

  const runDeliver = useCallback(async () => {
    if (!selection || !gif) return;
    setDelivery({ phase: 'run', step: 'folders' });
    const unsub = window.neku.onDeliverStep((step) =>
      setDelivery((d) => (d && d.phase === 'run' ? { phase: 'run', step } : d))
    );
    try {
      const payload = {
        stagingId: staging.stagingId,
        clientName,
        thumb: await makeThumb(await spriteBlob(selection, previewCache)),
        gifBytes: new Uint8Array(await gif.file.arrayBuffer()),
        sprite:
          selection.kind === 'drive'
            ? { kind: 'drive', id: selection.id, name: selection.name }
            : {
                kind: 'local',
                name: selection.name,
                bytes: new Uint8Array(await selection.file.arrayBuffer()),
              },
      };
      const res = await window.neku.deliver(payload);
      if (res.ok) {
        setDelivery({ phase: 'done', result: res.data });
        refreshStaging(true);
      } else {
        setDelivery({ phase: 'error', message: res.message, authExpired: res.code === 'auth' });
      }
    } finally {
      unsub();
    }
  }, [selection, gif, clientName, staging.stagingId, refreshStaging]);

  // "next commission" stays inside the current batch: that is the whole point of
  // batching, one pick at the start and then straight through the queue
  const resetForNext = useCallback(() => {
    setSelection(null);
    setClientName('');
    setFolderExists(null);
    setGif((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return null;
    });
    // last commission's download is not an offer for this one
    setFoundGif(null);
    setDelivery(null);
    refreshStaging();
  }, [refreshStaging]);

  const reconnect = useCallback(async () => {
    const res = await window.neku.login();
    if (res.ok) {
      setDelivery(null);
      refreshStaging();
    }
  }, [refreshStaging]);

  /* ---------- test hooks (mock mode only, used by npm run shots) ---------- */

  useEffect(() => {
    if (!state.mock) return undefined;
    window.__nekuTest = {
      setName: (n) => setClientName(n),
      setGif: async () => {
        const res = await window.neku.getFileBytes('mock-sprite-1');
        if (res.ok) {
          attachGif(new File([new Uint8Array(res.data)], 'ezgif-4-b2a91c.gif', { type: 'image/gif' }));
        }
      },
      deliver: () => {
        window.__nekuDeliverCalls = (window.__nekuDeliverCalls || 0) + 1;
        return runDeliver();
      },
      phase: () => (deliveryRef.current ? deliveryRef.current.phase : 'idle'),
      refresh: () => refreshStaging(true),
      foundGif: () => (foundGif ? foundGif.name : ''),
      useFoundGif: () => useFoundGif(foundGif),
      gifName: () => (gif ? gif.file.name : ''),
      probe: () =>
        JSON.stringify({
          sel: Boolean(selection),
          gif: Boolean(gif),
          name: clientName,
          batch: state.batch.name,
          phase: deliveryRef.current ? deliveryRef.current.phase : 'idle',
          calls: window.__nekuDeliverCalls || 0,
        }),
    };
  });

  /* ---------- render ---------- */

  const namePreview = nameOk
    ? `${spriteFileName(clientName)} + ${GIF_FILE_NAME} → ${state.settings.rootName}/${state.batch.name}/${cleanClientName(clientName)}`
    : null;

  return (
    <main
      className="workbench"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        for (const f of e.dataTransfer.files) routeDroppedFile(f);
      }}
    >
      <LightTable
        staging={staging}
        selection={selection}
        // once he has typed the client, a saved copy may as well carry the
        // delivery name; before that, keep whatever the tablet called it
        suggestedName={nameOk ? spriteFileName(clientName) : null}
        onSelect={setSelection}
        onRefresh={refreshStaging}
        onDiscard={discardSprite}
        onLocalSprite={attachLocalSprite}
        onReconnect={reconnect}
        previewCache={previewCache}
        busy={Boolean(delivery && delivery.phase === 'run')}
      />
      <PackingSlip
        clientName={clientName}
        onClientName={setClientName}
        folderExists={folderExists}
        namePreview={namePreview}
        rootName={state.settings.rootName}
        batchName={state.batch.name}
        gif={gif}
        onGif={attachGif}
        foundGif={foundGif}
        onUseFoundGif={() => useFoundGif(foundGif)}
        dropFlash={dropFlash}
        selection={selection}
        canDeliver={canDeliver}
        delivery={delivery}
        onDeliver={runDeliver}
        onRetry={runDeliver}
        onReconnect={reconnect}
        onNext={resetForNext}
      />
    </main>
  );
}
