import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyTemplate,
  cleanName,
  resolveNaming,
  revisionFolderName,
  templateVars,
} from '../../main/naming.mjs';
import LightTable, { PIXEL_ART_MAX } from './LightTable.jsx';
import PackingSlip from './PackingSlip.jsx';

const POLL_MS = 15000;
const THUMB_MAX = 128;

/* Extensions the light table can preview, and therefore what a dropped file has
   to be to count as the artwork rather than the attachment. */
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];
const extOf = (name) => {
  const dot = String(name || '').lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
};

/* If the attached-file template ends in a literal extension ("bouncy.gif"), that
   is the only thing that belongs in the slot and a wrong drop is worth catching.
   A template ending in {ext} takes whatever he drags, so nothing is enforced. */
function fixedAttachedExt(naming) {
  const template = String(naming.attachedTemplate || '');
  if (template.includes('{ext}')) return null;
  const ext = extOf(template);
  return ext || null;
}

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
  const res = await window.sendoff.getFileBytes(selection.id);
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
    // pixel art must not go soft, but smoothing off makes a downscaled photo
    // grainy, so let the size decide the same way the light table does
    ctx.imageSmoothingEnabled = bitmap.width > PIXEL_ART_MAX;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    return canvas.toDataURL('image/png');
  } catch {
    return null; // a missing thumbnail must never block a delivery
  }
}

export default function Workbench({ state }) {
  // every name this screen shows or sends comes from these, never from a constant
  const naming = useMemo(() => resolveNaming(state.settings.naming), [state.settings.naming]);
  const attachedExt = useMemo(() => fixedAttachedExt(naming), [naming]);

  const [staging, setStaging] = useState({
    loading: true,
    stagingId: null,
    files: [],
    error: null,
    authLost: false,
  });
  const [selection, setSelection] = useState(null); // {kind:'drive',id,name}|{kind:'local',file,name}
  const [clientName, setClientName] = useState('');
  const [folderExists, setFolderExists] = useState(null); // null | { projectName, nextRevision }
  const [asRevision, setAsRevision] = useState(false); // deliver into v2/v3 instead
  const [clients, setClients] = useState([]); // everyone delivered to before
  const [gif, setGif] = useState(null); // { file, url }
  const [foundGif, setFoundGif] = useState(null); // gif Sendoff saw land in Downloads
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
    const res = await window.sendoff.listStaging();
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
      if (arrived.length > 0) window.sendoff.announceSprite(arrived[0]);
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

  /* ---------- an existing client folder ----------
     Looks across every project, not just this one. The hit means one of two
     things and the app cannot tell which, so it does not guess: for the artist
     Sendoff was built for it is a typo (he has no repeat clients), and for everyone
     else it is a revision. Both are offered; delivering into the existing folder
     stays the default, so his flow is unchanged unless he picks otherwise. */

  useEffect(() => {
    setFolderExists(null);
    setAsRevision(false);
    const name = clientName.trim();
    if (!name) return undefined;
    const timer = setTimeout(async () => {
      const res = await window.sendoff.checkClientFolder(name);
      if (res.ok && res.data.exists) {
        setFolderExists({
          projectName: res.data.projectName,
          nextRevision: res.data.nextRevision,
        });
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [clientName]);

  // names he has delivered to before, so he can pick instead of retyping
  useEffect(() => {
    window.sendoff.listClients().then((res) => {
      if (res.ok) setClients(res.data);
    });
  }, [delivery]);

  /* ---------- gif + local sprite intake ---------- */

  const attachGif = useCallback(
    (file) => {
      if (attachedExt && extOf(file.name) !== attachedExt) {
        setDropFlash(`"${file.name}" is not a ${attachedExt}`);
        return;
      }
      setGif((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { file, url: URL.createObjectURL(file) };
      });
      setDropFlash(null);
    },
    [attachedExt]
  );

  const attachLocalSprite = useCallback((file) => {
    setSelection({ kind: 'local', file, name: file.name });
    setDropFlash(null);
  }, []);

  /* ---------- the gif Sendoff spotted in Downloads ----------
     Main only hands over metadata, so the bytes are fetched at the moment he
     accepts. Wrapping them in a File keeps every downstream path (preview,
     swap, deliver) identical to a dragged one. */

  const useFoundGif = useCallback(
    async (info) => {
      if (!info) return;
      const res = await window.sendoff.readGif(info.path);
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
    window.sendoff.setGifAttached(Boolean(gif));
  }, [gif]);

  useEffect(() => {
    // covers the gap between main spotting one and this listener existing
    window.sendoff.getLatestGif().then((res) => {
      if (res.ok && res.data) setFoundGif(res.data);
    });
    const offFound = window.sendoff.onGifFound((g) => setFoundGif(g));
    const offUse = window.sendoff.onGifUse((g) => useFoundGif(g));
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
    const res = await window.sendoff.discardStaged(selection.id);
    if (!res.ok) return res.message;
    setSelection(null);
    refreshStaging(true);
    return null;
  }, [selection, refreshStaging]);

  /* Which of the two slots a dropped file belongs in. The attachment's own
     extension wins when the template fixes one (a dropped .gif is the animation,
     never the artwork); otherwise anything previewable goes on the light table
     and everything else is the attachment. */
  const routeDroppedFile = useCallback(
    (file) => {
      const ext = extOf(file.name);
      if (attachedExt) {
        if (ext === attachedExt) attachGif(file);
        else if (IMAGE_EXTS.includes(ext)) attachLocalSprite(file);
        else setDropFlash(`"${file.name}": expected an image or a ${attachedExt}`);
        return;
      }
      if (IMAGE_EXTS.includes(ext) && !selection) attachLocalSprite(file);
      else attachGif(file);
    },
    [attachGif, attachLocalSprite, attachedExt, selection]
  );

  /* ---------- deliver ---------- */

  const nameOk = (() => {
    try {
      return Boolean(cleanName(clientName));
    } catch {
      return false;
    }
  })();

  /* Exactly what will be created, resolved through the same templates the main
     process will use. Preview-before-upload is a requirement, so this has to be
     the real answer and not an approximation of it. */
  const resolved = useMemo(() => {
    if (!nameOk) return null;
    const base = {
      clientName: cleanName(clientName),
      projectName: state.project.name,
      projectNumber: state.project.number ?? null,
    };
    try {
      return {
        client: base.clientName,
        staged: applyTemplate(
          naming.stagedTemplate,
          templateVars({ ...base, fileName: selection ? selection.name : '' })
        ),
        attached: applyTemplate(
          naming.attachedTemplate,
          templateVars({ ...base, fileName: gif ? gif.file.name : '' })
        ),
      };
    } catch {
      // a template that fills in to nothing: say so rather than showing a lie
      return null;
    }
  }, [nameOk, clientName, naming, selection, gif, state.project]);
  const canDeliver =
    Boolean(selection) && nameOk && Boolean(gif) && (!delivery || delivery.phase !== 'run');

  const runDeliver = useCallback(async () => {
    if (!selection || !gif) return;
    setDelivery({ phase: 'run', step: 'folders' });
    const unsub = window.sendoff.onDeliverStep((step) =>
      setDelivery((d) => (d && d.phase === 'run' ? { phase: 'run', step } : d))
    );
    try {
      const payload = {
        stagingId: staging.stagingId,
        clientName,
        thumb: await makeThumb(await spriteBlob(selection, previewCache)),
        gifBytes: new Uint8Array(await gif.file.arrayBuffer()),
        gifName: gif.file.name,
        /* Fixed here rather than resolved during the upload, so a Retry after a
           partial failure targets the same revision folder it already made. */
        revision: asRevision && folderExists ? folderExists.nextRevision : null,
        sprite:
          selection.kind === 'drive'
            ? { kind: 'drive', id: selection.id, name: selection.name }
            : {
                kind: 'local',
                name: selection.name,
                bytes: new Uint8Array(await selection.file.arrayBuffer()),
              },
      };
      const res = await window.sendoff.deliver(payload);
      if (res.ok) {
        setDelivery({ phase: 'done', result: res.data });
        refreshStaging(true);
      } else {
        setDelivery({ phase: 'error', message: res.message, authExpired: res.code === 'auth' });
      }
    } finally {
      unsub();
    }
  }, [selection, gif, clientName, staging.stagingId, refreshStaging, asRevision, folderExists]);

  // "next commission" stays inside the current project: that is the whole point of
  // projecting, one pick at the start and then straight through the queue
  const resetForNext = useCallback(() => {
    setSelection(null);
    setClientName('');
    setFolderExists(null);
    setAsRevision(false);
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
    const res = await window.sendoff.login();
    if (res.ok) {
      setDelivery(null);
      refreshStaging();
    }
  }, [refreshStaging]);

  /* ---------- test hooks (mock mode only, used by npm run shots) ---------- */

  useEffect(() => {
    if (!state.mock) return undefined;
    window.__sendoffTest = {
      setName: (n) => setClientName(n),
      setGif: async () => {
        const res = await window.sendoff.getFileBytes('mock-sprite-1');
        if (res.ok) {
          attachGif(new File([new Uint8Array(res.data)], 'ezgif-4-b2a91c.gif', { type: 'image/gif' }));
        }
      },
      deliver: () => {
        window.__sendoffDeliverCalls = (window.__sendoffDeliverCalls || 0) + 1;
        return runDeliver();
      },
      phase: () => (deliveryRef.current ? deliveryRef.current.phase : 'idle'),
      refresh: () => refreshStaging(true),
      pick: (id) => {
        const file = staging.files.find((f) => f.id === id);
        if (file) setSelection({ kind: 'drive', id: file.id, name: file.name });
        return Boolean(file);
      },
      foundGif: () => (foundGif ? foundGif.name : ''),
      useFoundGif: () => useFoundGif(foundGif),
      gifName: () => (gif ? gif.file.name : ''),
      probe: () =>
        JSON.stringify({
          sel: Boolean(selection),
          gif: Boolean(gif),
          name: clientName,
          project: state.project.name,
          phase: deliveryRef.current ? deliveryRef.current.phase : 'idle',
          calls: window.__sendoffDeliverCalls || 0,
        }),
    };
  });

  /* ---------- render ---------- */

  const namePreview = resolved
    ? `${resolved.staged} + ${resolved.attached} → ${state.settings.rootName}/${state.project.name}/${resolved.client}`
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
        suggestedName={resolved ? resolved.staged : null}
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
        asRevision={asRevision}
        onAsRevision={setAsRevision}
        revisionName={
          folderExists && folderExists.nextRevision
            ? revisionFolderName(naming.revisionTemplate, folderExists.nextRevision)
            : null
        }
        clients={clients}
        namePreview={namePreview}
        rootName={state.settings.rootName}
        projectName={state.project.name}
        attachedName={resolved ? resolved.attached : null}
        attachedExt={attachedExt}
        stagedName={resolved ? resolved.staged : null}
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
