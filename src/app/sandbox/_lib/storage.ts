/**
 * Browser-only persistence for the sandbox: saved positions, analysis trees and the last session,
 * all in localStorage. Positions are shared through the URL fragment, so they never reach a server.
 */
import { ISerializedTree } from '../_engine/SandboxEngine';

const KEY_POSITIONS = 'sandbox.savedPositions.v1';
const KEY_ANALYSES = 'sandbox.analyses.v1';
const KEY_DRAFT = 'sandbox.editorDraft.v1';
const KEY_PREFS = 'sandbox.prefs.v1';

export interface ISavedPosition {
    id: string;
    name: string;
    text: string;
    savedAt: string;
}

export interface ISavedAnalysis {
    id: string;
    name: string;
    savedAt: string;
    data: ISerializedTree;
}

const read = <T>(key: string, fallback: T): T => {
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
        return fallback;
    }
};

const write = (key: string, value: unknown) => {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.warn('sandbox: localStorage write failed', e);
    }
};

export const listSavedPositions = (): ISavedPosition[] => read<ISavedPosition[]>(KEY_POSITIONS, []);

export const savePosition = (name: string, text: string): ISavedPosition => {
    const all = listSavedPositions();
    const existing = all.find((p) => p.name === name);
    const entry: ISavedPosition = { id: existing?.id ?? `p${Date.now().toString(36)}`, name, text, savedAt: new Date().toISOString() };
    write(KEY_POSITIONS, [entry, ...all.filter((p) => p.id !== entry.id)]);
    return entry;
};

export const deleteSavedPosition = (id: string) => write(KEY_POSITIONS, listSavedPositions().filter((p) => p.id !== id));

export const listSavedAnalyses = (): ISavedAnalysis[] => read<ISavedAnalysis[]>(KEY_ANALYSES, []);

export const saveAnalysis = (id: string, name: string, data: ISerializedTree) => {
    const all = listSavedAnalyses().filter((a) => a.id !== id);
    // keep the list bounded: analyses carry whole trees
    write(KEY_ANALYSES, [{ id, name, savedAt: new Date().toISOString(), data }, ...all].slice(0, 30));
};

export const deleteSavedAnalysis = (id: string) => write(KEY_ANALYSES, listSavedAnalyses().filter((a) => a.id !== id));

export const loadEditorDraft = (): string | null => read<string | null>(KEY_DRAFT, null);
export const saveEditorDraft = (text: string) => write(KEY_DRAFT, text);

export interface ISandboxPrefs {
    viewMode?: 'both' | 'p1' | 'p2';
    orientation?: 'decider' | 'p1' | 'p2';
}
export const loadPrefs = (): ISandboxPrefs => read<ISandboxPrefs>(KEY_PREFS, {});
export const savePrefs = (prefs: ISandboxPrefs) => write(KEY_PREFS, prefs);

// ---------------- URL sharing ----------------

const toBase64Url = (bytes: Uint8Array) => {
    let bin = '';
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (s: string) => {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
        out[i] = bin.charCodeAt(i);
    }
    return out;
};

/** URL-fragment form of a position: `#pos=<base64url(utf8 text)>`. Kept uncompressed so it decodes synchronously. */
export const encodePositionForUrl = (text: string) => toBase64Url(new TextEncoder().encode(text));

export const decodePositionFromUrl = (encoded: string): string | null => {
    try {
        return new TextDecoder().decode(fromBase64Url(encoded));
    } catch {
        return null;
    }
};

export const shareUrlFor = (text: string) => {
    const base = `${window.location.origin}${window.location.pathname}`;
    return `${base}#pos=${encodePositionForUrl(text)}`;
};

export const readPositionFromLocation = (): string | null => {
    const hash = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(hash);
    const pos = params.get('pos');
    return pos ? decodePositionFromUrl(pos) : null;
};

export const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // fallback for browsers/contexts without the async clipboard API
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch {
            ok = false;
        }
        document.body.removeChild(area);
        return ok;
    }
};
