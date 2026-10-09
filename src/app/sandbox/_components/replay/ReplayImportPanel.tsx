'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Box, Button, IconButton, Slider, Tooltip, Typography } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ShuffleIcon from '@mui/icons-material/Shuffle';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { Seat } from '../../_engine/SandboxEngine';
import { useCardIndex } from '../../_lib/cardIndex';
import { IDecklist, parseDecklist } from '../../_lib/replay/decklist';
import { IForgeRecording, parseForgeRecording, recordingFrom } from '../../_lib/replay/forgeExport';
import { IHandoffPayload, listenForHandoff, readHandoffHash } from '../../_lib/replay/forgeHandoff';
import { IPickUpOk, buildPickUp, logUpTo } from '../../_lib/replay/pickUp';
import { IReplayCards, loadSetCodeMap, replayCardsFrom } from '../../_lib/replay/replayCards';
import { IReplayGame, IReplayMoment, momentForFrame, nearestCleanMoment, pairRecordings } from '../../_lib/replay/replayGame';
import {
    IStoredRecording, IStoredReplay, addStoredPick, deleteStoredReplay, listStoredReplays, loadReplaySession, loadStoredRecordings, saveReplaySession,
    storeReplay, updateStoredReplay,
} from '../../_lib/replay/replayStore';
import { SEAT_COLOR, panelSx, pillButtonSx, primaryButtonSx, sectionTitleSx } from '../sandboxTheme';

/** `onLoadText` loads position text into the editor (Edit mode); an empty message loads quietly (scrub preview). */
interface IReplayImportPanelProps {
    onLoadText: (text: string, message: string) => void;
}

const SEATS: Seat[] = ['p1', 'p2'];
const small = { fontSize: '0.72rem', m: 0 };
const dim = { ...small, color: 'rgba(255,255,255,0.55)' };
const textareaSx = {
    width: '100%', minHeight: '3.2rem', resize: 'vertical' as const, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.68rem',
    color: '#e8f6ff', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', p: '6px', outline: 'none',
};

interface IDeckState { deck: IDecklist | null; error: string | null; warnings?: string[] }

/**
 * Survives the panel unmounting: the Position tab unmounts when hidden, and the stage remounts its content when
 * the first engine board arrives. localStorage (replayStore) covers reloads; this covers the page's lifetime.
 */
const memory = {
    recs: [] as IForgeRecording[],
    deckText: { p1: '', p2: '' } as Record<Seat, string>,

    /** the moment on show, per game */
    moment: null as { gameId: string; key: string } | null,
    picked: null as { key: string; result: IPickUpOk } | null,
    error: null as string | null,

    /** where a (re)opened replay should land, and whose pick to show again */
    pendingMomentKey: null as string | null,
    pendingPicked: null as string | null,

    /** the page reopens the last replay from localStorage once; nothing is saved back until that has finished */
    restoreStarted: false,
    restoring: false,

    /** "Open in sandbox" from SWU Forge (forgeHandoff.ts): what the panel says about it, the game when it arrives,
     *  the recorder frame to land on, and whether to pick up once both decklists are in */
    handoffNote: null as string | null,
    pendingHandoff: null as IHandoffPayload | null,
    pendingFrame: null as { step: number; forgeFrame: number | null } | null,
    handoffPickUp: false,
};
let memoryVersion = 0;
const storedThisPage = new Set<string>();
const memoryListeners = new Set<() => void>();
const subscribeMemory = (listener: () => void) => {
    memoryListeners.add(listener);
    return () => {
        memoryListeners.delete(listener);
    };
};
const memoryVersionNow = () => memoryVersion;

/** Update the panel's memory; whichever instance is mounted (an import may finish after a remount) re-renders. */
const remember = (patch: Partial<typeof memory>) => {
    Object.assign(memory, patch);
    memoryVersion++;
    memoryListeners.forEach((l) => l());
};

/**
 * Position tab: import a double-sided SWU Forge replay, scrub to a moment (the board previews it), and
 * "Pick up from here" into the sandbox with both decks rebuilt from the decklists.
 */
const ReplayImportPanel: React.FC<IReplayImportPanelProps> = ({ onLoadText }) => {
    const { index } = useCardIndex();
    const [setCodes, setSetCodes] = useState<Record<string, string> | null>(null);
    // the panel unmounts whenever the Position tab is hidden: start from where it was (client-only route)
    const [initial] = useState(loadReplaySession);
    const [open, setOpen] = useState(initial.open);
    const memoryVersionSeen = useSyncExternalStore(subscribeMemory, memoryVersionNow, memoryVersionNow);
    const { recs, error, deckText, picked } = memory;
    const setRecs = (next: IForgeRecording[]) => remember({ recs: next });
    const setError = (next: string | null) => remember({ error: next });
    const setPicked = (next: { key: string; result: IPickUpOk } | null) => remember({ picked: next });
    const setDeckText = (next: Record<Seat, string> | ((d: Record<Seat, string>) => Record<Seat, string>)) =>
        remember({ deckText: typeof next === 'function' ? next(memory.deckText) : next });
    const [momentIdx, setMomentIdx] = useState<number | null>(null);
    const [seed, setSeed] = useState(initial.seed);
    const [snapNote, setSnapNote] = useState<string | null>(null);
    const [frameInput, setFrameInput] = useState('');
    const [stored, setStored] = useState<IStoredReplay[]>(listStoredReplays);
    const [preview, setPreview] = useState(true);

    /** set by the user's own actions (import, scrub, decklist): only those put the moment on the board */
    const [wantPreview, setWantPreview] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const lastPreview = useRef<string | null>(null);
    const onLoadTextRef = useRef(onLoadText);
    onLoadTextRef.current = onLoadText;

    const cards: IReplayCards | null = useMemo(() => (index ? replayCardsFrom(index, setCodes) : null), [index, setCodes]);

    const paired = useMemo(() => (recs.length === 2 ? pairRecordings(recs[0], recs[1]) : null), [recs]);
    const game: IReplayGame | null = paired?.ok ? paired.game : null;
    const pairError = paired && !paired.ok ? paired.error : null;
    const clean = useMemo(() => game?.moments.filter((m) => m.clean) ?? [], [game]);
    const moment: IReplayMoment | null = game && momentIdx != null ? game.moments[momentIdx] ?? null : null;

    const leaderName = useCallback((seat: Seat, g: IReplayGame | null = game) => {
        const id = g?.seats[seat].leaderCardId;
        return (id && cards?.bySetCode(id)?.title) || seat.toUpperCase();
    }, [cards, game]);

    // ---------------- decklists ----------------

    const decks: Record<Seat, IDeckState> = useMemo(() => {
        const out = { p1: { deck: null, error: null }, p2: { deck: null, error: null } } as Record<Seat, IDeckState>;
        if (!cards) {
            return out;
        }
        for (const seat of SEATS) {
            const text = deckText[seat].trim();
            if (!text) {
                continue;
            }
            const res = parseDecklist(text, cards);
            out[seat] = res.ok ? { deck: res.deck, error: null, warnings: res.warnings } : { deck: null, error: res.error };
        }
        return out;
    }, [deckText, cards]);

    const setDeck = (seat: Seat, text: string) => {
        // a deck pasted into the wrong seat's box goes to the seat whose leader it has
        if (game && cards && text.trim()) {
            const res = parseDecklist(text, cards);
            const leaderOf = (s: Seat) => (game.seats[s].leaderCardId ? cards.bySetCode(game.seats[s].leaderCardId!)?.internalName : null);
            const otherSeat: Seat = seat === 'p1' ? 'p2' : 'p1';
            if (res.ok && res.deck.leader && res.deck.leader !== leaderOf(seat) && res.deck.leader === leaderOf(otherSeat) && !deckText[otherSeat].trim()) {
                setDeckText((d) => ({ ...d, [otherSeat]: text }));
                setWantPreview(true);
                return;
            }
        }
        setDeckText((d) => ({ ...d, [seat]: text }));
        setWantPreview(true);
    };

    // pasted decklists are kept with the replay (an empty box never wipes one kept before)
    useEffect(() => {
        const kept = game && listStoredReplays().find((r) => r.id === game.gameId);
        if (kept) {
            const pasted = Object.fromEntries(Object.entries(deckText).filter(([, text]) => text.trim()));
            updateStoredReplay(kept.id, { decks: { ...kept.decks, ...pasted } });
        }
    }, [deckText, game]);

    // ---------------- importing ----------------

    const importTexts = async (files: { name: string; text: string }[]) => {
        remember({ error: null, handoffNote: null });
        const before = memory.recs;
        let next = [...before];
        const errors: string[] = [];
        for (const f of files) {
            const res = parseForgeRecording(f.text);
            if (!res.ok) {
                errors.push(files.length > 1 ? `${f.name}: ${res.error}` : res.error);
                continue;
            }
            const rec = res.recording;
            if (next.length && next[0].gameId !== rec.gameId) {
                next = [];
            }
            next = [...next.filter((r) => r.recorderId !== rec.recorderId), rec].slice(-2);
        }
        if (errors.length) {
            setError(errors.join('\n'));
        }
        if (next.length !== before.length || next.some((r, i) => r !== before[i])) {
            setRecs(next);
            setPicked(null);
            setMomentIdx(null);
            setWantPreview(true);
            lastPreview.current = null;
            if (next.length < 2 || next[0].gameId !== before[0]?.gameId) {
                setDeckText({ p1: '', p2: '' });
            }
        }
    };

    const onFiles = async (list: FileList | null) => {
        if (!list?.length) {
            return;
        }
        const files = await Promise.all(Array.from(list).map(async (f) => ({ name: f.name, text: await f.text() })));
        await importTexts(files);
        if (fileRef.current) {
            fileRef.current.value = '';
        }
    };

    // a pairing (new, reopened or remounted): go to the remembered moment, and reuse decklists pasted before
    useEffect(() => {
        if (!game) {
            return;
        }
        const existing = listStoredReplays().find((r) => r.id === game.gameId);
        if (existing && !memory.deckText.p1.trim() && !memory.deckText.p2.trim() && (existing.decks.p1 || existing.decks.p2)) {
            setDeckText({ p1: existing.decks.p1 ?? '', p2: existing.decks.p2 ?? '' });
        }
        // handed over from SWU Forge: the frame the viewer was on (snapped like a typed frame number)
        const handed = memory.pendingFrame;
        if (handed) {
            memory.pendingFrame = null;
            memory.pendingMomentKey = null;
            const at = momentForFrame(game, Math.min(handed.step, game.a.frames.length - 1));
            const target = at?.clean ? at : nearestCleanMoment(game, at?.index ?? 0);
            setMomentIdx(target?.index ?? null);
            const where = handed.forgeFrame ? `SWU Forge frame ${handed.forgeFrame} (sandbox frame ${handed.step})` : `frame ${handed.step}`;
            setSnapNote(at && !at.clean && target ? `${where} can't be picked up (${at.why}). Snapped to frame ${target.a.last}: ${target.label}.` : null);
            return;
        }
        const wanted = memory.pendingMomentKey
            ?? (memory.moment?.gameId === game.gameId ? memory.moment.key : null)
            ?? existing?.lastMomentKey ?? null;
        memory.pendingMomentKey = null;
        const target = (wanted && game.moments.find((m) => m.key === wanted && m.clean)) || clean[Math.floor(clean.length / 2)] || null;
        setMomentIdx(target?.index ?? null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [game]);

    // keep it in this browser (once per page and game; the title needs the card names)
    useEffect(() => {
        if (!game || !cards || storedThisPage.has(game.gameId)) {
            return;
        }
        storedThisPage.add(game.gameId);
        const toStored = (r: IForgeRecording): IStoredRecording => ({ source: r.source, doubleSidedAvailable: r.doubleSidedAvailable, deckName: r.deckName, timeline: r.timeline });
        storeReplay(
            { id: game.gameId, title: `${leaderName('p1', game)} vs ${leaderName('p2', game)}`, decks: memory.deckText },
            [toStored(game.a), toStored(game.b)],
        ).then(() => setStored(listStoredReplays()));
    }, [game, cards, leaderName]);

    const openStored = async (r: IStoredReplay, momentKey?: string | null, opts: { preview?: boolean; pickedKey?: string | null; keepOpen?: boolean } = {}) => {
        remember({ error: null, handoffNote: null });
        const data = await loadStoredRecordings(r.id);
        if (!data) {
            setError('That replay is no longer stored in this browser.');
            return;
        }
        const parsed = data.map((d) => recordingFrom(d.timeline, d.source, { doubleSidedAvailable: d.doubleSidedAvailable, deckName: d.deckName }));
        const bad = parsed.find((p) => !p.ok);
        if (bad && !bad.ok) {
            setError(bad.error);
            return;
        }
        memory.pendingMomentKey = momentKey ?? r.lastMomentKey ?? null;
        memory.pendingPicked = opts.pickedKey ?? null;
        setDeckText({ p1: r.decks.p1 ?? '', p2: r.decks.p2 ?? '' });
        setPicked(null);
        lastPreview.current = null;
        setWantPreview(opts.preview !== false);
        setRecs(parsed.map((p) => (p as { recording: IForgeRecording }).recording));
        if (!opts.keepOpen) {
            setOpen(true);
        }
    };

    // once per page: reopen the replay shown before a reload, without touching the board (the panel remounts
    // often: the Position tab unmounts when hidden; memory carries it across those)
    useEffect(() => {
        loadSetCodeMap().then(setSetCodes);
        if (memory.restoreStarted) {
            return;
        }
        memory.restoreStarted = true;
        const handoff = readHandoffHash(window.location.hash);
        if (handoff) {
            // the nonce is single-use: a reload must not ask the opener again
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
            remember({ handoffNote: 'Opening a game from SWU Forge…', error: null });
            setOpen(true);
            listenForHandoff(handoff, (event) => (event.kind === 'payload'
                ? remember({ pendingHandoff: event.payload, handoffNote: 'Got the game from SWU Forge…' })
                : remember({ handoffNote: null, error: event.error })));
            return;
        }
        const r = initial.id ? listStoredReplays().find((x) => x.id === initial.id) : null;
        if (r && !memory.recs.length) {
            memory.restoring = true;
            openStored(r, initial.momentKey, { preview: false, pickedKey: initial.pickedKey, keepOpen: true }).finally(() => {
                memory.restoring = false;
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---------------- handed over from SWU Forge ----------------

    useEffect(() => {
        const h = memory.pendingHandoff;
        if (!h || !cards) {
            return;
        }
        memory.pendingHandoff = null;
        const parsed = h.seats.map((s) => recordingFrom(s.recording, 'timeline', { doubleSidedAvailable: true, deckName: s.deckName }));
        const bad = parsed.find((p) => !p.ok);
        if (bad && !bad.ok) {
            remember({ handoffNote: null, error: `SWU Forge's game could not be read: ${bad.error}` });
            return;
        }
        const leaders = h.seats.map((s) => s.leader ?? 'a leader').join(' vs ');
        memory.pendingFrame = h.frame;
        memory.handoffPickUp = true;
        lastPreview.current = null;
        remember({
            handoffNote: `From SWU Forge: ${leaders}${h.frame.forgeFrame ? `, opened at frame ${h.frame.forgeFrame}` : ''}.`,
            error: null,
            picked: null,
            deckText: { p1: JSON.stringify(h.seats[0].decklist, null, 1), p2: JSON.stringify(h.seats[1].decklist, null, 1) },
            recs: parsed.map((p) => (p as { recording: IForgeRecording }).recording),
        });
        setWantPreview(true);
        setOpen(true);
    }, [cards, memoryVersionSeen]);

    // ---------------- the current moment ----------------

    const decklists = useMemo(() => ({ p1: decks.p1.deck, p2: decks.p2.deck }), [decks]);
    const build = useMemo(() => (game && moment && cards && moment.clean
        ? buildPickUp(game, moment, cards, { decks: decklists, seed, requireDecks: false })
        : null), [game, moment, cards, decklists, seed]);

    // scrubbing previews the moment on the board (quietly, debounced)
    useEffect(() => {
        if (!wantPreview || !preview || !build?.ok || build.text === lastPreview.current) {
            return;
        }
        const t = window.setTimeout(() => {
            lastPreview.current = build.text;
            setWantPreview(false);
            onLoadTextRef.current(build.text, '');
        }, 160);
        return () => window.clearTimeout(t);
    }, [build, preview, wantPreview]);

    // a restored pick keeps its approximations on show
    useEffect(() => {
        if (!memory.pendingPicked || !game || !moment || !cards || moment.key !== memory.pendingPicked) {
            return;
        }
        const res = buildPickUp(game, moment, cards, { decks: decklists, seed, requireDecks: true });
        if (res.ok) {
            memory.pendingPicked = null;
            setPicked({ key: moment.key, result: res });
        }
    }, [game, moment, cards, decklists, seed]);

    useEffect(() => {
        if (!game || !moment) {
            return;
        }
        const t = window.setTimeout(() => updateStoredReplay(game.gameId, { lastMomentKey: moment.key }), 400);
        return () => window.clearTimeout(t);
    }, [game, moment]);

    useEffect(() => {
        if (game && moment) {
            memory.moment = { gameId: game.gameId, key: moment.key };
        }
    }, [game, moment]);

    useEffect(() => {
        if (memory.restoring || !memory.restoreStarted) {
            return;
        }
        saveReplaySession({ id: game?.gameId ?? null, momentKey: moment?.key ?? null, seed, open, pickedKey: picked?.key ?? null });
    }, [game, moment, seed, open, picked]);

    useEffect(() => {
        if (!memory.handoffPickUp || !game || !moment?.clean || !cards || !decks.p1.deck || !decks.p2.deck) {
            return;
        }
        memory.handoffPickUp = false;
        pickUp();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [game, moment, cards, decks]);

    const goClean = (pos: number) => {
        const m = clean[Math.max(0, Math.min(clean.length - 1, pos))];
        if (m) {
            setMomentIdx(m.index);
            setSnapNote(null);
            setPicked(null);
            setWantPreview(true);
        }
    };
    const cleanPos = moment ? clean.findIndex((m) => m.index === moment.index) : -1;

    const goFrame = () => {
        if (!game) {
            return;
        }
        const frame = Number(frameInput);
        if (!Number.isFinite(frame)) {
            return;
        }
        const at = momentForFrame(game, Math.max(0, Math.min(game.a.frames.length - 1, Math.round(frame))));
        if (!at) {
            return;
        }
        const target = at.clean ? at : nearestCleanMoment(game, at.index);
        if (!target) {
            setSnapNote('No moment in this replay can be picked up.');
            return;
        }
        setMomentIdx(target.index);
        setPicked(null);
        setWantPreview(true);
        setSnapNote(at.clean ? null : `Frame ${frame} can't be picked up (${at.why}). Snapped to frame ${target.a.last}: ${target.label}.`);
    };

    const pickUp = () => {
        if (!game || !moment || !cards) {
            return;
        }
        const res = buildPickUp(game, moment, cards, { decks: decklists, seed, requireDecks: true });
        if (!res.ok) {
            setError(res.error);
            return;
        }
        setError(null);
        lastPreview.current = res.text;
        setWantPreview(false);
        onLoadText(res.text, `Picked up: ${moment.label}`);
        setPicked({ key: moment.key, result: res });
        addStoredPick(game.gameId, { momentKey: moment.key, label: moment.label, seed, pickedAt: new Date().toISOString() });
        setStored(listStoredReplays());
    };

    // ---------------- render ----------------

    const status = !recs.length
        ? null
        : recs.length === 1
            ? `Got ${recs[0].source === 'replayPage' ? 'one player\'s' : 'a'} recording (${cards?.bySetCode(recs[0].frames[0].gamestate.players[recs[0].recorderId]?.leader?.cardId ?? '')?.title ?? 'leader ?'}'s side). Now add the other player's recording of the same game.`
            : game
                ? `${leaderName('p1')} (P1) vs ${leaderName('p2')} (P2): ${clean.length} of ${game.moments.length} moments can be picked up.`
                : null;

    const report = (seat: Seat) => {
        const r = build?.ok ? build.decks[seat] : null;
        if (!r) {
            return null;
        }
        return (
            <Typography sx={{ ...small, color: r.matches ? 'var(--selection-green)' : '#ffd166' }} data-testid={`replay-deck-report-${seat}`} data-matches={r.matches ? 'true' : 'false'}>
                Deck {r.deck.length} {r.matches ? '=' : '≠'} replay {r.replayDeckCount}{r.matches ? ' ✓' : ''}
            </Typography>
        );
    };

    return (
        <Box sx={{ ...panelSx, p: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }} data-testid="replay-import">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }} onClick={() => setOpen(!open)}>
                <Typography sx={sectionTitleSx}>SWU Forge replay</Typography>
                {game && !open && <Typography sx={{ ...dim, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{leaderName('p1')} vs {leaderName('p2')}{moment ? ` · ${moment.label}` : ''}</Typography>}
                <Box sx={{ flex: 1 }} />
                {open ? <ExpandLessIcon sx={{ fontSize: '1rem', color: 'rgba(255,255,255,0.6)' }} /> : <ExpandMoreIcon sx={{ fontSize: '1rem', color: 'rgba(255,255,255,0.6)' }} data-testid="replay-open" />}
            </Box>
            {open && (
                <>
                    <Box sx={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <Button size="small" sx={pillButtonSx} startIcon={<UploadFileIcon sx={{ fontSize: '0.95rem !important' }} />} onClick={() => fileRef.current?.click()} data-testid="replay-choose">
                            Import replay…
                        </Button>
                        <input ref={fileRef} type="file" accept=".json,application/json" multiple hidden onChange={(e) => onFiles(e.target.files)} data-testid="replay-file-input" />
                        {recs.length === 2 && (
                            <Tooltip title="Swap which recording is P1">
                                <IconButton size="small" sx={{ color: '#fff', p: '2px' }} onClick={() => {
                                    setRecs([recs[1], recs[0]]);
                                    setDeckText({ p1: deckText.p2, p2: deckText.p1 });
                                    setPicked(null);
                                    setWantPreview(true);
                                }} data-testid="replay-swap"><SwapHorizIcon sx={{ fontSize: '1rem' }} /></IconButton>
                            </Tooltip>
                        )}
                    </Box>
                    {!recs.length && (
                        <Typography sx={dim}>
                            Double-sided games only. From each player&apos;s replay page on SWU Forge, save <code>__data.json</code> (the page address
                            plus <code>/__data.json</code>), then choose both files. The &ldquo;both sides&rdquo; JSON works as the second file too.
                        </Typography>
                    )}
                    {memory.handoffNote && <Typography sx={{ ...small, color: '#00BAFF' }} data-testid="replay-handoff">{memory.handoffNote}</Typography>}
                    {status && <Typography sx={small} data-testid="replay-status">{status}</Typography>}
                    {(error || pairError) && (
                        <Typography sx={{ ...small, color: '#ff8a8a', whiteSpace: 'pre-wrap' }} data-testid="replay-error">{error ?? pairError}</Typography>
                    )}

                    {game && (
                        <>
                            {/* decklists: replays never carry them */}
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <Typography sx={{ ...sectionTitleSx, fontSize: '0.64rem' }}>Decklists</Typography>
                                <Typography sx={dim}>The replay doesn&apos;t include decklists. Paste each deck&apos;s JSON (SWU Forge deck export or SWUDB).</Typography>
                                {SEATS.map((seat) => (
                                    <Box key={seat} sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                        <Box sx={{ display: 'flex', gap: '6px', alignItems: 'baseline' }}>
                                            <Typography sx={{ ...small, fontWeight: 800, color: SEAT_COLOR[seat] }}>{seat.toUpperCase()} · {leaderName(seat)}</Typography>
                                            {game.seats[seat].deckName && <Typography sx={dim}>({game.seats[seat].deckName})</Typography>}
                                            <Box sx={{ flex: 1 }} />
                                            {decks[seat].deck && <Typography sx={{ ...small, color: 'var(--selection-green)' }} data-testid={`replay-deck-ok-${seat}`}>{decks[seat].deck!.size} cards</Typography>}
                                        </Box>
                                        <Box
                                            component="textarea"
                                            value={deckText[seat]}
                                            placeholder={`${seat.toUpperCase()} deck JSON: { "leader": …, "base": …, "deck": [{ "id": "SEC_034", "count": 3 }, …] }`}
                                            spellCheck={false}
                                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDeck(seat, e.target.value)}
                                            onKeyDown={(e: React.KeyboardEvent) => e.stopPropagation()}
                                            sx={textareaSx}
                                            data-testid={`replay-deck-${seat}`}
                                        />
                                        {decks[seat].error && <Typography sx={{ ...small, color: '#ff8a8a' }}>{decks[seat].error}</Typography>}
                                        {decks[seat].warnings?.map((w, i) => <Typography key={i} sx={{ ...small, color: '#ffd166' }} data-testid={`replay-deck-warning-${seat}`}>{w}</Typography>)}
                                    </Box>
                                ))}
                            </Box>

                            {/* the scrubber: pick-up-able moments only */}
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <IconButton size="small" sx={{ color: '#fff', p: '2px' }} onClick={() => goClean(cleanPos - 1)} disabled={cleanPos <= 0} data-testid="replay-prev" aria-label="Previous moment"><ChevronLeftIcon sx={{ fontSize: '1.1rem' }} /></IconButton>
                                    <Slider
                                        size="small"
                                        min={0}
                                        max={Math.max(0, clean.length - 1)}
                                        step={1}
                                        value={Math.max(0, cleanPos)}
                                        onChange={(_, v) => goClean(v as number)}
                                        marks={clean.map((m, i) => ({ m, i })).filter(({ m, i }) => i === 0 || clean[i - 1].round !== m.round).map(({ i }) => ({ value: i }))}
                                        sx={{ flex: 1, mx: '6px', color: '#00BAFF' }}
                                        data-testid="replay-scrubber"
                                    />
                                    <IconButton size="small" sx={{ color: '#fff', p: '2px' }} onClick={() => goClean(cleanPos + 1)} disabled={cleanPos >= clean.length - 1} data-testid="replay-next" aria-label="Next moment"><ChevronRightIcon sx={{ fontSize: '1.1rem' }} /></IconButton>
                                </Box>
                                {moment && (
                                    <>
                                        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                                            <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, m: 0, color: moment.active ? SEAT_COLOR[moment.active] : '#fff' }} data-testid="replay-moment-label" data-moment-key={moment.key}>
                                                {moment.label}
                                            </Typography>
                                            <Box sx={{ flex: 1 }} />
                                            <Typography sx={dim}>frame</Typography>
                                            <Box
                                                component="input"
                                                value={frameInput || String(moment.a.last)}
                                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFrameInput(e.target.value.replace(/[^0-9]/g, ''))}
                                                onKeyDown={(e: React.KeyboardEvent) => {
                                                    e.stopPropagation();
                                                    if (e.key === 'Enter') {
                                                        goFrame();
                                                        setFrameInput('');
                                                    }
                                                }}
                                                onBlur={() => {
                                                    if (frameInput) {
                                                        goFrame();
                                                        setFrameInput('');
                                                    }
                                                }}
                                                sx={{ width: '3.2rem', fontSize: '0.72rem', color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '4px', px: '4px' }}
                                                data-testid="replay-frame-input"
                                                aria-label="Go to frame"
                                            />
                                            <Typography sx={dim}>/ {game.a.frames.length - 1}</Typography>
                                        </Box>
                                        <Box sx={{ borderLeft: '2px solid rgba(255,255,255,0.15)', pl: '6px' }} data-testid="replay-log">
                                            {logUpTo(game, moment, 2).map((l, i) => (
                                                <Typography key={i} sx={{ ...small, color: i === 1 || logUpTo(game, moment, 2).length === 1 ? '#e8f6ff' : 'rgba(255,255,255,0.5)' }}>{l}</Typography>
                                            ))}
                                        </Box>
                                    </>
                                )}
                                {snapNote && <Typography sx={{ ...small, color: '#ffd166' }} data-testid="replay-snap-note">{snapNote}</Typography>}
                            </Box>

                            {/* deck check and pick up */}
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                {SEATS.map((seat) => (
                                    <Box key={seat} sx={{ display: 'flex', gap: '4px', alignItems: 'baseline' }}>
                                        <Typography sx={{ ...small, fontWeight: 800, color: SEAT_COLOR[seat] }}>{seat.toUpperCase()}</Typography>
                                        {report(seat) ?? <Typography sx={dim}>needs decklist</Typography>}
                                    </Box>
                                ))}
                                <Box sx={{ flex: 1 }} />
                                <Tooltip title="Reshuffle the unknown deck order">
                                    <IconButton size="small" sx={{ color: '#fff', p: '2px' }} onClick={() => {
                                        setSeed(Math.random().toString(36).slice(2, 7));
                                        setPicked(null);
                                        setWantPreview(true);
                                    }} data-testid="replay-reshuffle"><ShuffleIcon sx={{ fontSize: '0.95rem' }} /></IconButton>
                                </Tooltip>
                                <Button
                                    size="small"
                                    sx={{ ...primaryButtonSx, py: 0.3 }}
                                    disabled={!moment?.clean || !decks.p1.deck || !decks.p2.deck}
                                    onClick={pickUp}
                                    data-testid="replay-pickup"
                                >
                                    Pick up from here
                                </Button>
                            </Box>
                            {(!decks.p1.deck || !decks.p2.deck) && <Typography sx={dim}>The board shows the moment; picking up needs both decklists, so both decks can be rebuilt.</Typography>}
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Box component="input" type="checkbox" checked={preview} onChange={() => setPreview(!preview)} id="replay-preview" />
                                <Box component="label" htmlFor="replay-preview" sx={dim}>Show the moment on the board while scrubbing</Box>
                            </Box>

                            {build?.ok && build.warnings.length > 0 && (
                                <Box data-testid="replay-warnings">
                                    {build.warnings.map((w, i) => <Typography key={i} sx={{ ...small, color: '#ffd166' }}>{w}</Typography>)}
                                </Box>
                            )}
                            {picked && moment?.key === picked.key && (
                                <Box sx={{ background: 'rgba(255,209,102,0.06)', border: '1px solid rgba(255,209,102,0.3)', borderRadius: '6px', p: '6px' }} data-testid="replay-approximations">
                                    <Typography sx={{ ...sectionTitleSx, fontSize: '0.64rem', color: '#ffd166' }}>Approximations</Typography>
                                    {picked.result.approximations.map((a, i) => <Typography key={i} sx={{ ...small, mt: '2px' }}>• {a}</Typography>)}
                                    <Typography sx={{ ...dim, mt: '4px' }}>Press Play to play it out. The position is in the link (Copy link) and in Edit.</Typography>
                                </Box>
                            )}
                        </>
                    )}

                    {stored.length > 0 && (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', mt: '2px' }}>
                            <Typography sx={{ ...sectionTitleSx, fontSize: '0.64rem' }}>Imported replays</Typography>
                            {stored.map((r) => (
                                <Box key={r.id}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', '&:hover': { background: 'rgba(255,255,255,0.06)' }, borderRadius: '4px', px: '4px' }} onClick={() => openStored(r)} data-testid={`replay-stored-${r.id}`}>
                                        <Typography sx={{ ...small, flex: 1, fontWeight: game?.gameId === r.id ? 800 : 400 }}>{r.title}</Typography>
                                        <Typography sx={{ fontSize: '0.62rem', m: 0, color: 'rgba(255,255,255,0.4)' }}>{new Date(r.savedAt).toLocaleDateString()}</Typography>
                                        <IconButton size="small" sx={{ p: '1px', color: '#ff8a8a' }} onClick={(e) => {
                                            e.stopPropagation();
                                            deleteStoredReplay(r.id);
                                            setStored(listStoredReplays());
                                        }}><DeleteOutlineIcon sx={{ fontSize: '0.85rem' }} /></IconButton>
                                    </Box>
                                    {r.picks.slice(0, 5).map((p) => (
                                        <Typography
                                            key={`${p.momentKey}-${p.seed}`}
                                            sx={{ ...dim, pl: '14px', cursor: 'pointer', '&:hover': { color: '#fff' } }}
                                            onClick={() => (game?.gameId === r.id
                                                ? (() => {
                                                    const m = game.moments.find((x) => x.key === p.momentKey);
                                                    if (m) {
                                                        setMomentIdx(m.index);
                                                        setSeed(p.seed);
                                                        setWantPreview(true);
                                                    }
                                                })()
                                                : openStored(r, p.momentKey).then(() => setSeed(p.seed)))}
                                        >
                                            ↳ {p.label}
                                        </Typography>
                                    ))}
                                </Box>
                            ))}
                        </Box>
                    )}
                </>
            )}
        </Box>
    );
};

export default ReplayImportPanel;
