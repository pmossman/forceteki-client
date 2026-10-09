/**
 * Imported replays in this browser (localStorage), so a replay and the moments picked from it survive a
 * reload. Nothing leaves the browser.
 *
 *   sandbox.replays.v1            index: IStoredReplay[] (newest first, at most MAX_REPLAYS)
 *   sandbox.replay.v1.<gameId>    the two recordings (gzip+base64 when CompressionStream exists, else JSON)
 */
import type { Seat } from '../../_engine/SandboxEngine';
import { PersistedTimeline } from './forgeTimeline';
import { RecordingSource } from './forgeExport';

const KEY_INDEX = 'sandbox.replays.v1';
const KEY_DATA = (id: string) => `sandbox.replay.v1.${id}`;
const MAX_REPLAYS = 6;

export interface IStoredPick {
    momentKey: string;
    label: string;
    seed: string;
    pickedAt: string;
}

export interface IStoredReplay {
    id: string;
    title: string;
    savedAt: string;

    /** pasted decklist JSON per seat, as pasted */
    decks: Partial<Record<Seat, string>>;
    picks: IStoredPick[];
    lastMomentKey?: string;
}

export interface IStoredRecording {
    source: RecordingSource;
    doubleSidedAvailable: boolean | null;
    deckName: string | null;
    timeline: PersistedTimeline;
}

const read = <T>(key: string, fallback: T): T => {
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
        return fallback;
    }
};

const write = (key: string, value: string): boolean => {
    try {
        window.localStorage.setItem(key, value);
        return true;
    } catch {
        return false;
    }
};

export const listStoredReplays = (): IStoredReplay[] => read<IStoredReplay[]>(KEY_INDEX, []);

const writeIndex = (list: IStoredReplay[]) => write(KEY_INDEX, JSON.stringify(list));

export const updateStoredReplay = (id: string, patch: Partial<Omit<IStoredReplay, 'id'>>) => {
    const list = listStoredReplays();
    const i = list.findIndex((r) => r.id === id);
    if (i >= 0) {
        list[i] = { ...list[i], ...patch, savedAt: new Date().toISOString() };
        writeIndex(list);
    }
};

export const addStoredPick = (id: string, pick: IStoredPick) => {
    const r = listStoredReplays().find((x) => x.id === id);
    if (r) {
        updateStoredReplay(id, { picks: [pick, ...r.picks.filter((p) => p.momentKey !== pick.momentKey || p.seed !== pick.seed)].slice(0, 20) });
    }
};

export const deleteStoredReplay = (id: string) => {
    writeIndex(listStoredReplays().filter((r) => r.id !== id));
    try {
        window.localStorage.removeItem(KEY_DATA(id));
    } catch {
        // ignore
    }
};

// ---------------- payload (compressed when the browser can) ----------------

const toBase64 = (bytes: Uint8Array) => {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
};

const fromBase64 = (s: string) => {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
        out[i] = bin.charCodeAt(i);
    }
    return out;
};

const pipe = async (bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> => {
    const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
    return new Uint8Array(await out.arrayBuffer());
};

const encode = async (value: unknown): Promise<string> => {
    const json = JSON.stringify(value);
    if (typeof CompressionStream === 'undefined') {
        return `json:${json}`;
    }
    return `gz:${toBase64(await pipe(new TextEncoder().encode(json), new CompressionStream('gzip')))}`;
};

const decode = async <T>(raw: string): Promise<T> => {
    if (raw.startsWith('gz:')) {
        return JSON.parse(new TextDecoder().decode(await pipe(fromBase64(raw.slice(3)), new DecompressionStream('gzip')))) as T;
    }
    return JSON.parse(raw.startsWith('json:') ? raw.slice(5) : raw) as T;
};

/**
 * Save (or refresh) a replay. Evicts the oldest replays to stay under MAX_REPLAYS and to make room when the
 * browser's storage is full. Returns false if it could not be stored at all.
 */
export const storeReplay = async (meta: Omit<IStoredReplay, 'savedAt' | 'picks'> & { picks?: IStoredPick[] }, recordings: [IStoredRecording, IStoredRecording]): Promise<boolean> => {
    const payload = await encode(recordings);
    const existing = listStoredReplays().find((r) => r.id === meta.id);
    const pasted = Object.fromEntries(Object.entries(meta.decks ?? {}).filter(([, text]) => text && text.trim()));
    const entry: IStoredReplay = { picks: existing?.picks ?? [], ...meta, decks: { ...existing?.decks, ...pasted }, savedAt: new Date().toISOString() };
    let list = [entry, ...listStoredReplays().filter((r) => r.id !== meta.id)];
    while (list.length > MAX_REPLAYS) {
        deleteStoredReplay(list[list.length - 1].id);
        list = list.slice(0, -1);
    }
    while (!write(KEY_DATA(meta.id), payload)) {
        const victim = list.length > 1 ? list[list.length - 1] : null;
        if (!victim) {
            return false;
        }
        deleteStoredReplay(victim.id);
        list = list.slice(0, -1);
    }
    return writeIndex(list);
};

export const loadStoredRecordings = async (id: string): Promise<[IStoredRecording, IStoredRecording] | null> => {
    try {
        const raw = window.localStorage.getItem(KEY_DATA(id));
        return raw ? await decode<[IStoredRecording, IStoredRecording]>(raw) : null;
    } catch {
        return null;
    }
};

// ---------------- the panel's own state (it unmounts when the Position tab is hidden) ----------------

const KEY_SESSION = 'sandbox.replaySession.v1';

export interface IReplaySession {
    id: string | null;
    momentKey: string | null;
    seed: string;
    open: boolean;

    /** the moment last picked up (its approximations stay on show) */
    pickedKey: string | null;
}

export const loadReplaySession = (): IReplaySession =>
    ({ id: null, momentKey: null, seed: '', open: false, pickedKey: null, ...read<Partial<IReplaySession>>(KEY_SESSION, {}) });

export const saveReplaySession = (s: IReplaySession) => write(KEY_SESSION, JSON.stringify(s));
