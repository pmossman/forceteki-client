'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { CardImageLocaleProvider } from '@/app/_contexts/CardImageLocale.context';
import { PopupProvider } from '@/app/_contexts/Popup.context';
import { OngoingEffectHighlightProvider } from '@/app/_contexts/OngoingEffectHighlight.context';
import { ThemeContextProvider } from '@/app/_contexts/Theme.context';
import { Seat } from '../_engine/SandboxEngine';
import { CardIndex, useCardIndex } from '../_lib/cardIndex';
import { IPosition, fromEnginePosition, toEnginePosition } from '../_lib/position';
import { decodePositionText, encodePositionText } from '../_lib/positionText';
import { DEFAULT_PRESET_ID, PRESETS } from '../_lib/presets';
import {
    ISavedAnalysis, ISavedPosition, copyToClipboard, deleteSavedPosition, encodePositionForUrl, listSavedAnalyses, listSavedPositions,
    loadEditorDraft, loadPrefs, readPositionFromLocation, saveEditorDraft, savePosition, savePrefs, shareUrlFor,
} from '../_lib/storage';
import { useEditor } from '../_lib/useEditor';
import { useEditorShortcuts } from '../_lib/useEditorShortcuts';
import { useSandboxSession } from '../_lib/useSandboxSession';
import { BoardPatch } from '../_lib/optimistic';
import { IValidationIssue, validatePosition } from '../_lib/validate';
import TopBar from './TopBar';
import SandboxStage, { PanelTab, StageMode } from './SandboxStage';
import PositionTab from './panel/PositionTab';
import { Orientation, ViewMode } from './play/SandboxGameBridge';

/** Text -> editor model. Returns the model, or the issues that stop it from loading. */
const textToPosition = (text: string, index: CardIndex): { position?: IPosition; issues: IValidationIssue[] } => {
    const decoded = decodePositionText(text);
    const issues: IValidationIssue[] = decoded.errors.map((e) => ({ ...e, severity: 'error' as const }));
    if (issues.length) {
        return { issues };
    }
    const { position, issues: resolve } = fromEnginePosition(decoded.position, index);
    issues.push(...resolve.map((r) => ({ ...r, severity: 'error' as const })));
    return issues.length ? { issues } : { position, issues: decoded.warnings.map((w) => ({ ...w, severity: 'warning' as const })) };
};

/** Canonical text for comparing two positions (our own encoding of the decoded text). */
const canonical = (text: string, index: CardIndex): string | null => {
    const res = textToPosition(text, index);
    return res.position ? encodePositionText(toEnginePosition(res.position, index)) : null;
};

const SandboxShell: React.FC = () => {
    const { index, error: indexError } = useCardIndex();
    const session = useSandboxSession();
    const editor = useEditor();
    const [mode, setMode] = useState<StageMode>('edit');
    const [toast, setToast] = useState<string | null>(null);
    const [previewIssues, setPreviewIssues] = useState<IValidationIssue[]>([]);
    const [starting, setStarting] = useState(false);
    const [savedPositions, setSavedPositions] = useState<ISavedPosition[]>([]);
    const [savedAnalyses, setSavedAnalyses] = useState<ISavedAnalysis[]>([]);
    const [viewMode, setViewMode] = useState<ViewMode>(() => loadPrefs().viewMode ?? 'both');
    const [orientation, setOrientation] = useState<Orientation>(() => loadPrefs().orientation ?? 'decider');
    const [focusedDecider, setFocusedDecider] = useState<Seat | null>(null);
    const [panelOpen, setPanelOpen] = useState(true);
    const [panelTab, setPanelTab] = useState<PanelTab>('position');
    const [playText, setPlayText] = useState('');
    const initialised = useRef(false);
    const toastTimer = useRef<number | undefined>(undefined);
    // optimistic edits: patches shown on the board until the engine's state for that edit arrives
    const [patches, setPatches] = useState<{ seq: number; patch: BoardPatch }[]>([]);
    const editSeq = useRef(0);
    const optimistic = useMemo(() => ({
        commit: (patch: BoardPatch) => {
            const seq = ++editSeq.current;
            setPatches((ps) => [...ps, { seq, patch }]);
        },
        tempId: () => `opt-${editSeq.current + 1}`,
    }), []);

    const flash = useCallback((msg: string) => {
        setToast(msg);
        window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast(null), 2400);
    }, []);

    useEffect(() => savePrefs({ viewMode, orientation }), [viewMode, orientation]);
    useEditorShortcuts(editor, mode === 'edit');

    // first position: the URL (#pos=...), then the last draft, then the Krennic preset
    useEffect(() => {
        if (!index || initialised.current) {
            return;
        }
        initialised.current = true;
        const fromUrl = readPositionFromLocation();
        for (const text of [fromUrl, loadEditorDraft()]) {
            if (text) {
                const res = textToPosition(text, index);
                if (res.position) {
                    editor.replace(res.position, false);
                    if (text === fromUrl) {
                        flash('Loaded the position from the link');
                    }
                    return;
                }
            }
        }
        const preset = textToPosition(PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!.text, index);
        if (preset.position) {
            editor.replace(preset.position, false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [index]);

    const refreshSaved = useCallback(() => {
        setSavedPositions(listSavedPositions());
        setSavedAnalyses(listSavedAnalyses());
    }, []);
    useEffect(refreshSaved, [refreshSaved, session.snapshot?.nodeId, mode]);

    const positionText = useMemo(
        () => (index ? encodePositionText(toEnginePosition(editor.position, index)) : ''),
        [editor.position, index]
    );
    const clientIssues = useMemo(() => validatePosition(editor.position, index), [editor.position, index]);

    // Edit mode: every change is loaded into the engine and the real board shows the result
    useEffect(() => {
        if (mode !== 'edit' || !positionText || session.status !== 'ready') {
            return;
        }
        let live = true;
        const t = window.setTimeout(() => {
            const seq = editSeq.current;
            session.preview(positionText).then((res) => {
                if (res?.ok) {
                    // the engine's board now includes every edit up to seq: drop their stand-ins
                    setPatches((ps) => (ps.length ? ps.filter((p) => p.seq > seq) : ps));
                }
                if (live && res) {
                    setPreviewIssues([
                        ...res.errors.map((e) => ({ ...e, severity: 'error' as const })),
                        ...res.warnings.map((w) => ({ ...w, severity: 'warning' as const })),
                    ]);
                }
            });
        }, 120);
        return () => {
            live = false;
            window.clearTimeout(t);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [positionText, mode, session.status]);

    // leaving Edit drops any stand-ins
    useEffect(() => {
        if (mode !== 'edit') {
            setPatches([]);
        }
    }, [mode]);

    // keep the URL and the local draft in step with the editor (shareable at any moment)
    useEffect(() => {
        if (!positionText || mode !== 'edit') {
            return;
        }
        const t = window.setTimeout(() => {
            window.history.replaceState(null, '', `#pos=${encodePositionForUrl(positionText)}`);
            saveEditorDraft(positionText);
        }, 250);
        return () => window.clearTimeout(t);
    }, [positionText, mode]);

    // Play mode: the Position tab shows the board as it is now
    useEffect(() => {
        if (mode !== 'play' || !session.snapshot || session.pendingNodeId) {
            return;
        }
        let live = true;
        session.exportPosition().then((res) => live && res && setPlayText(res.text));
        return () => {
            live = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, session.snapshot?.nodeId, session.pendingNodeId]);

    const issues = useMemo(() => {
        const seen = new Set<string>();
        return [...clientIssues, ...previewIssues].filter((i) => {
            const key = `${i.severity}:${i.message}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }, [clientIssues, previewIssues]);

    const firstError = issues.find((i) => i.severity === 'error');
    const playDisabledReason = !index ? 'Loading cards…' :
        session.status !== 'ready' ? (session.engine.kind === 'socket' ? 'The engine is not connected (is the sandbox server on :9600 running?)' : `The engine is starting${session.statusDetail ? ` (${session.statusDetail})` : ''}`) :
            firstError ? `Fix first: ${firstError.message}` : null;

    // ---------------- mode switching ----------------

    const goPlay = async () => {
        if (mode === 'play' || !index) {
            return;
        }
        if (playDisabledReason) {
            flash(playDisabledReason);
            return;
        }
        setStarting(true);
        try {
            const parked = session.stashed;
            const unchanged = parked && canonical(parked.tree.root.positionText, index) === positionText;
            if (unchanged) {
                if (!await session.resumeStash()) {
                    return;
                }
            } else {
                const res = await session.start(positionText, editor.position.title);
                if (!res.ok) {
                    setPreviewIssues(res.errors.map((e) => ({ ...e, severity: 'error' as const })));
                    flash('The engine rejected this position');
                    return;
                }
            }
            setMode('play');
            setPanelTab('play');
        } catch (e) {
            flash(`Could not start: ${(e as Error).message}`);
        } finally {
            setStarting(false);
        }
    };

    /** Play -> Edit. 'start': the analysis's start position (unchanged, Play returns to the same tree). 'here': the current board. */
    const goEdit = async (from: 'start' | 'here') => {
        if (!index || (mode === 'edit' && from === 'start')) {
            return;
        }
        const hereText = from === 'here' ? (await session.exportPosition())?.text ?? null : null;
        const parked = mode === 'play' ? await session.stash() : null;
        const text = from === 'here' ? hereText : parked?.tree.root.positionText ?? null;
        if (text) {
            const parsed = textToPosition(text, index);
            if (parsed.position) {
                parsed.position.title = from === 'here'
                    ? (session.analysisTitle ? `${session.analysisTitle} (continued)` : undefined)
                    : (parked?.title && parked.title !== 'Untitled position' ? parked.title : editor.position.title);
                if (from === 'here' || canonical(text, index) !== positionText) {
                    editor.replace(parsed.position);
                }
            } else {
                flash(`Could not open that position: ${parsed.issues[0]?.message}`);
            }
        }
        setMode('edit');
        setPanelTab('position');
        if (from === 'here') {
            flash('The current board is now the start position');
        }
    };

    const onMode = (m: StageMode) => (m === 'play' ? goPlay() : goEdit('start'));

    // ---------------- copy / share / presets ----------------

    const currentText = async (): Promise<string | null> => {
        if (mode === 'edit') {
            return positionText;
        }
        const res = await session.exportPosition();
        return res?.text ?? null;
    };

    const copyText = async () => {
        const text = await currentText();
        if (text && await copyToClipboard(text)) {
            flash('Position text copied');
        }
    };

    const copyLink = async () => {
        const text = await currentText();
        if (text && await copyToClipboard(shareUrlFor(text))) {
            flash('Link copied');
        }
    };

    const loadIntoEditor = async (text: string, message: string) => {
        if (!index) {
            return;
        }
        const res = textToPosition(text, index);
        if (!res.position) {
            flash(res.issues[0]?.message ?? 'Could not load');
            return;
        }
        if (mode === 'play') {
            await session.stash();
            setMode('edit');
        }
        editor.replace(res.position);
        flash(message);
    };

    const applyText = (text: string): IValidationIssue[] => {
        if (!index) {
            return [];
        }
        const res = textToPosition(text, index);
        if (res.position) {
            editor.replace(res.position);
            flash('Position applied');
            return [];
        }
        return res.issues;
    };

    const resumeAnalysis = async (a: ISavedAnalysis) => {
        if (mode === 'play') {
            await session.stash();
        }
        const ok = await session.restore(a.data, a.id, a.name);
        if (ok) {
            setMode('play');
            setPanelTab('play');
        }
    };

    if (indexError) {
        return <Centered>Card data could not be loaded: {indexError}</Centered>;
    }
    if (!index) {
        return <Centered>Loading cards…</Centered>;
    }

    const title = mode === 'play' ? session.analysisTitle : (editor.position.title ?? '');

    const positionTab = (
        <PositionTab
            editing={mode === 'edit'}
            text={mode === 'edit' ? positionText : playText}
            issues={mode === 'edit' ? issues : []}
            onApplyText={applyText}
            onCopyText={copyText}
            onCopyLink={copyLink}
            onPreset={(id) => {
                const preset = PRESETS.find((p) => p.id === id);
                if (preset) {
                    loadIntoEditor(preset.text, `Preset: ${preset.title}`);
                }
            }}
            onSavePosition={() => {
                const name = editor.position.title || `Position ${new Date().toLocaleString()}`;
                savePosition(name, positionText);
                refreshSaved();
                flash(`Saved "${name}"`);
            }}
            savedPositions={savedPositions}
            savedAnalyses={savedAnalyses}
            onLoadSaved={(p) => loadIntoEditor(p.text, `Loaded "${p.name}"`)}
            onDeleteSaved={(id) => {
                deleteSavedPosition(id);
                refreshSaved();
            }}
            onResumeAnalysis={resumeAnalysis}
        />
    );

    return (
        <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#05080c' }}>
            <TopBar
                mode={mode}
                onMode={onMode}
                title={title}
                onTitleChange={(t) => editor.setMeta({ title: t || undefined })}
                viewMode={viewMode}
                onViewMode={setViewMode}
                orientation={orientation}
                onOrientation={setOrientation}
                onResetToStart={() => session.snapshot && session.goto(session.snapshot.tree.rootId)}
                onEditFromHere={() => goEdit('here')}
                onCopyText={copyText}
                onCopyLink={copyLink}
                engineStatus={session.status}
                engineDetail={session.statusDetail}
                engineKind={session.engine.kind}
                panelOpen={panelOpen}
                onTogglePanel={() => setPanelOpen(!panelOpen)}
                toast={toast}
            />
            <Box sx={{ flex: 1, minHeight: 0 }}>
                <SandboxStage
                    mode={mode}
                    session={session}
                    index={index}
                    editor={editor}
                    issues={issues}
                    onPlay={goPlay}
                    playDisabledReason={playDisabledReason}
                    starting={starting}
                    resumeTitle={session.stashed?.title ?? null}
                    viewMode={viewMode}
                    orientation={orientation}
                    focusedDecider={focusedDecider}
                    onFocusDecider={setFocusedDecider}
                    panelOpen={panelOpen}
                    panelTab={panelTab}
                    onPanelTab={setPanelTab}
                    positionTab={positionTab}
                    onMessage={flash}
                    patches={patches}
                    optimistic={optimistic}
                />
            </Box>
        </Box>
    );
};

const Centered: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <Box sx={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#05080c' }}>
        <Typography sx={{ color: 'rgba(255,255,255,0.7)' }}>{children}</Typography>
    </Box>
);

/** Account-free providers: no session, user, lobby socket or server settings (static-site direction). */
const SandboxApp: React.FC = () => (
    <CardImageLocaleProvider>
        <PopupProvider>
            <OngoingEffectHighlightProvider>
                <ThemeContextProvider>
                    <SandboxShell />
                </ThemeContextProvider>
            </OngoingEffectHighlightProvider>
        </PopupProvider>
    </CardImageLocaleProvider>
);

export default SandboxApp;
