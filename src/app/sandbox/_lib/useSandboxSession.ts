'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    EngineStatus, IIssue, ISandboxInput, ISandboxSnapshot, ISerializedTree, SandboxEngine,
} from '../_engine/SandboxEngine';
import { createSandboxEngine } from '../_engine/createEngine';
import { saveAnalysis } from './storage';

export interface ISessionApi {
    engine: SandboxEngine;
    status: EngineStatus;
    statusDetail?: string;

    /** what the board shows: the live snapshot, or a cached one while a jump replays */
    snapshot: ISandboxSnapshot | null;

    /** a goto is in flight to this node (the board shows its cached frame if we have one) */
    pendingNodeId: string | null;
    lastError: string | null;
    clearError: () => void;
    analysisId: string | null;
    analysisTitle: string;
    start: (positionText: string, title?: string) => Promise<{ ok: boolean; errors: IIssue[]; warnings: IIssue[] }>;

    /** Edit mode: load a position just to show it (no analysis, nothing saved). Stale results resolve as null. */
    preview: (positionText: string) => Promise<{ ok: boolean; errors: IIssue[]; warnings: IIssue[] } | null>;

    /** Before editing: park the running analysis (serialized) so Play can come back to it unchanged. */
    stash: () => Promise<{ tree: ISerializedTree; id: string; title: string } | null>;

    /** The parked analysis, if any. */
    stashed: { tree: ISerializedTree; id: string; title: string } | null;
    resumeStash: () => Promise<boolean>;
    restore: (tree: ISerializedTree, id: string, title: string) => Promise<boolean>;
    act: (input: ISandboxInput) => Promise<void>;
    goto: (nodeId: string) => Promise<void>;
    deleteNode: (nodeId: string) => Promise<void>;
    promoteNode: (nodeId: string) => Promise<void>;
    exportPosition: () => Promise<{ text: string; warnings: IIssue[] } | null>;
    stop: () => void;
}

/**
 * Owns the SandboxEngine and the analysis session: snapshots, a per-node display cache for instant
 * jumps, auto-save of the tree to localStorage, and transparent restore after a reconnect.
 */
export const useSandboxSession = (): ISessionApi => {
    const engine = useMemo<SandboxEngine>(() => createSandboxEngine(), []);
    const [status, setStatus] = useState<EngineStatus>('connecting');
    const [statusDetail, setStatusDetail] = useState<string | undefined>();
    const [snapshot, setSnapshot] = useState<ISandboxSnapshot | null>(null);
    const [pendingNodeId, setPendingNodeId] = useState<string | null>(null);
    const [lastError, setLastError] = useState<string | null>(null);
    const [analysisId, setAnalysisId] = useState<string | null>(null);
    const [analysisTitle, setAnalysisTitle] = useState('');

    const cache = useRef(new Map<string, ISandboxSnapshot>());
    const latestTree = useRef<ISerializedTree | null>(null);
    const active = useRef<{ id: string; title: string } | null>(null);
    const needsRestore = useRef(false);
    const saveTimer = useRef<number | undefined>(undefined);
    const liveSnapshot = useRef<ISandboxSnapshot | null>(null);
    const previewSeq = useRef(0);
    const [stashed, setStashed] = useState<{ tree: ISerializedTree; id: string; title: string } | null>(null);

    const persist = useCallback(() => {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(async () => {
            if (!active.current) {
                return;
            }
            try {
                const tree = await engine.serializeTree();
                if (tree && (tree as ISerializedTree).format === 'karabast-sandbox-tree') {
                    latestTree.current = tree;
                    saveAnalysis(active.current.id, active.current.title, tree);
                }
            } catch {
                // offline: the next snapshot retries
            }
        }, 350);
    }, [engine]);

    useEffect(() => {
        engine.connect();
        const offSnap = engine.onSnapshot((s) => {
            liveSnapshot.current = s;
            cache.current.set(s.nodeId, s);
            setSnapshot(s);
            setPendingNodeId(null);
            persist();
        });
        const offStatus = engine.onStatus((st, detail) => {
            setStatus(st);
            setStatusDetail(detail);
            if (st === 'disconnected' || st === 'error') {
                needsRestore.current = !!active.current;
            }
            if (st === 'ready' && needsRestore.current && latestTree.current) {
                needsRestore.current = false;
                engine.load({ tree: latestTree.current }).catch(() => undefined);
            }
        });
        return () => {
            offSnap();
            offStatus();
            engine.dispose();
        };
    }, [engine, persist]);

    const start = useCallback(async (positionText: string, title?: string) => {
        previewSeq.current++;
        const res = await engine.load({ position: positionText });
        if (!res.ok) {
            return { ok: false, errors: res.errors, warnings: res.warnings };
        }
        cache.current.clear();
        setStashed(null);
        const id = `a${Date.now().toString(36)}`;
        active.current = { id, title: title || 'Untitled position' };
        setAnalysisId(id);
        setAnalysisTitle(active.current.title);
        latestTree.current = null;
        // the snapshot event normally arrives first; set it here too so either order works
        liveSnapshot.current = res.snapshot;
        cache.current.set(res.snapshot.nodeId, res.snapshot);
        setSnapshot(res.snapshot);
        persist();
        return { ok: true, errors: [], warnings: res.warnings };
    }, [engine, persist]);

    const preview = useCallback(async (positionText: string) => {
        active.current = null;
        const seq = ++previewSeq.current;
        try {
            const res = await engine.load({ position: positionText });
            if (seq !== previewSeq.current) {
                return null;
            }
            if (!res.ok) {
                return { ok: false, errors: res.errors ?? [], warnings: res.warnings ?? [] };
            }
            liveSnapshot.current = res.snapshot;
            setSnapshot(res.snapshot);
            return { ok: true, errors: [], warnings: res.warnings ?? [] };
        } catch (e) {
            return seq === previewSeq.current ? { ok: false, errors: [{ path: '', message: (e as Error).message }], warnings: [] } : null;
        }
    }, [engine]);

    const stash = useCallback(async () => {
        if (!active.current) {
            return null;
        }
        const current = active.current;
        active.current = null;
        try {
            const tree = await engine.serializeTree();
            if (tree?.format === 'karabast-sandbox-tree') {
                saveAnalysis(current.id, current.title, tree);
                const parked = { tree, id: current.id, title: current.title };
                setStashed(parked);
                return parked;
            }
        } catch {
            // nothing to park
        }
        return null;
    }, [engine]);

    const restore = useCallback(async (tree: ISerializedTree, id: string, title: string) => {
        previewSeq.current++;
        const res = await engine.load({ tree });
        if (!res.ok) {
            setLastError(res.errors.map((e) => e.message).join('; ') || 'Could not restore this analysis');
            return false;
        }
        cache.current.clear();
        active.current = { id, title };
        setAnalysisId(id);
        setAnalysisTitle(title);
        latestTree.current = tree;
        liveSnapshot.current = res.snapshot;
        setSnapshot(res.snapshot);
        return true;
    }, [engine]);

    const resumeStash = useCallback(async () => {
        if (!stashed) {
            return false;
        }
        const ok = await restore(stashed.tree, stashed.id, stashed.title);
        if (ok) {
            setStashed(null);
        }
        return ok;
    }, [stashed, restore]);

    const act = useCallback(async (input: ISandboxInput) => {
        try {
            const res = await engine.act(input);
            if (!res.ok) {
                setLastError(res.error);
            }
        } catch (e) {
            setLastError((e as Error).message);
        }
    }, [engine]);

    const goto = useCallback(async (nodeId: string) => {
        const live = liveSnapshot.current;
        if (live?.nodeId === nodeId) {
            return;
        }
        setPendingNodeId(nodeId);
        const cached = cache.current.get(nodeId);
        if (cached && live) {
            // show the frame we already know instantly; the engine's replay replaces it in a moment
            setSnapshot({ ...cached, tree: live.tree, nodeId });
        }
        try {
            const res = await engine.goto(nodeId);
            if (!res.ok) {
                setLastError(res.error);
                setPendingNodeId(null);
                if (liveSnapshot.current) {
                    setSnapshot(liveSnapshot.current);
                }
            }
        } catch (e) {
            setLastError((e as Error).message);
            setPendingNodeId(null);
        }
    }, [engine]);

    const deleteNode = useCallback(async (nodeId: string) => {
        const res = await engine.deleteNode(nodeId);
        if (!res.ok) {
            setLastError(res.error);
        }
        for (const id of [...cache.current.keys()]) {
            if (!res.ok || !(res.snapshot.tree.nodes[id])) {
                cache.current.delete(id);
            }
        }
    }, [engine]);

    const promoteNode = useCallback(async (nodeId: string) => {
        const res = await engine.promoteNode(nodeId);
        if (!res.ok) {
            setLastError(res.error);
        }
    }, [engine]);

    const exportPosition = useCallback(async () => {
        try {
            const res = await engine.exportPosition();
            if (!res || typeof res.text !== 'string') {
                setLastError((res as unknown as { error?: string })?.error ?? 'Export failed');
                return null;
            }
            return { text: res.text, warnings: res.warnings ?? [] };
        } catch (e) {
            setLastError((e as Error).message);
            return null;
        }
    }, [engine]);

    const stop = useCallback(() => {
        active.current = null;
        setAnalysisId(null);
        setSnapshot(null);
        liveSnapshot.current = null;
        cache.current.clear();
    }, []);

    return {
        engine, status, statusDetail, snapshot, pendingNodeId, lastError, clearError: () => setLastError(null),
        analysisId, analysisTitle, start, preview, stash, stashed, resumeStash, restore, act, goto, deleteNode, promoteNode, exportPosition, stop,
    };
};
