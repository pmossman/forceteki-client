'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { CardImageLocaleProvider } from '@/app/_contexts/CardImageLocale.context';
import { PopupProvider } from '@/app/_contexts/Popup.context';
import { OngoingEffectHighlightProvider } from '@/app/_contexts/OngoingEffectHighlight.context';
import { ThemeContextProvider } from '@/app/_contexts/Theme.context';
import { CardIndex, useCardIndex } from '../_lib/cardIndex';
import { IPosition, fromEnginePosition, toEnginePosition } from '../_lib/position';
import { decodePositionText, encodePositionText } from '../_lib/positionText';
import { DEFAULT_PRESET_ID, PRESETS } from '../_lib/presets';
import {
    ISavedAnalysis, ISavedPosition, copyToClipboard, deleteSavedPosition, encodePositionForUrl, listSavedAnalyses, listSavedPositions,
    loadEditorDraft, readPositionFromLocation, saveEditorDraft, savePosition, shareUrlFor,
} from '../_lib/storage';
import { useEditor } from '../_lib/useEditor';
import { useSandboxSession } from '../_lib/useSandboxSession';
import { IValidationIssue, validatePosition } from '../_lib/validate';
import TopBar, { SandboxMode } from './TopBar';
import BoardEditor from './editor/BoardEditor';
import CardSearch from './editor/CardSearch';
import Inspector from './editor/Inspector';
import PositionPanel from './editor/PositionPanel';
import AnalysisView from './play/AnalysisView';

const RAIL_WIDTH = 'clamp(320px, 26vw, 430px)';

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

const SandboxShell: React.FC = () => {
    const { index, error: indexError } = useCardIndex();
    const session = useSandboxSession();
    const editor = useEditor();
    const [mode, setMode] = useState<SandboxMode>('setup');
    const [toast, setToast] = useState<string | null>(null);
    const [serverIssues, setServerIssues] = useState<IValidationIssue[]>([]);
    const [starting, setStarting] = useState(false);
    const [textCollapsed, setTextCollapsed] = useState(false);
    const [savedPositions, setSavedPositions] = useState<ISavedPosition[]>([]);
    const [savedAnalyses, setSavedAnalyses] = useState<ISavedAnalysis[]>([]);
    const searchRef = useRef<HTMLInputElement>(null);
    const initialised = useRef(false);
    const toastTimer = useRef<number | undefined>(undefined);

    const flash = useCallback((msg: string) => {
        setToast(msg);
        window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast(null), 2200);
    }, []);

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

    useEffect(() => {
        setSavedPositions(listSavedPositions());
        setSavedAnalyses(listSavedAnalyses());
    }, [session.snapshot?.nodeId, mode]);

    const positionText = useMemo(
        () => (index ? encodePositionText(toEnginePosition(editor.position, index)) : ''),
        [editor.position, index]
    );
    const clientIssues = useMemo(() => validatePosition(editor.position, index), [editor.position, index]);

    // keep the URL and the local draft in step with the editor (shareable at any moment)
    useEffect(() => {
        if (!positionText || mode !== 'setup') {
            return;
        }
        const t = window.setTimeout(() => {
            window.history.replaceState(null, '', `#pos=${encodePositionForUrl(positionText)}`);
            saveEditorDraft(positionText);
        }, 250);
        return () => window.clearTimeout(t);
    }, [positionText, mode]);

    // authoritative validation from the engine, debounced; never blocks typing
    useEffect(() => {
        if (!positionText || session.status !== 'ready' || mode !== 'setup') {
            return;
        }
        let live = true;
        const t = window.setTimeout(() => {
            session.engine.validatePosition({ text: positionText })
                .then((res) => {
                    if (!live || !res) {
                        return;
                    }
                    setServerIssues([
                        ...(res.errors ?? []).map((e) => ({ ...e, severity: 'error' as const })),
                        ...(res.warnings ?? []).map((w) => ({ ...w, severity: 'warning' as const })),
                    ]);
                })
                .catch(() => undefined);
        }, 300);
        return () => {
            live = false;
            window.clearTimeout(t);
        };
    }, [positionText, session.status, session.engine, mode]);

    const issues = useMemo(() => {
        const seen = new Set<string>();
        return [...clientIssues, ...serverIssues].filter((i) => {
            const key = `${i.severity}:${i.message}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }, [clientIssues, serverIssues]);

    const firstError = issues.find((i) => i.severity === 'error');
    const playDisabledReason = !index ? 'Loading cards…' :
        session.status !== 'ready' ? 'The engine is not connected (is the sandbox server on :9600 running?)' :
            firstError ? `Fix first: ${firstError.message}` : null;

    const requestSearch = useCallback(() => {
        window.setTimeout(() => searchRef.current?.focus(), 0);
    }, []);

    const play = async () => {
        setStarting(true);
        try {
            const res = await session.start(positionText, editor.position.title);
            if (!res.ok) {
                setServerIssues(res.errors.map((e) => ({ ...e, severity: 'error' as const })));
                flash('The engine rejected this position');
                return;
            }
            setMode('analyse');
        } catch (e) {
            flash(`Could not start: ${(e as Error).message}`);
        } finally {
            setStarting(false);
        }
    };

    const editCurrent = async () => {
        if (!index) {
            return;
        }
        const res = await session.exportPosition();
        if (!res) {
            return;
        }
        const parsed = textToPosition(res.text, index);
        if (parsed.position) {
            parsed.position.title = editor.position.title ? `${editor.position.title} (edited)` : undefined;
            editor.replace(parsed.position);
            setMode('setup');
            flash(res.warnings.length ? res.warnings[0].message : 'Current board opened in the editor');
        } else {
            flash(`Export could not be read: ${parsed.issues[0]?.message}`);
        }
    };

    const currentText = async (): Promise<string | null> => {
        if (mode === 'setup') {
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
        const ok = await session.restore(a.data, a.id, a.name);
        if (ok) {
            setMode('analyse');
        }
    };

    if (indexError) {
        return <Centered>Card data could not be loaded: {indexError}</Centered>;
    }
    if (!index) {
        return <Centered>Loading cards…</Centered>;
    }

    const title = mode === 'analyse' ? session.analysisTitle : (editor.position.title || 'Untitled position');

    return (
        <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#05080c' }}>
            <TopBar
                mode={mode}
                onMode={setMode}
                analyseAvailable={!!session.snapshot}
                title={title}
                engineStatus={session.status}
                engineDetail={session.statusDetail}
                savedPositions={savedPositions}
                savedAnalyses={savedAnalyses}
                onPreset={(id) => {
                    const preset = PRESETS.find((p) => p.id === id);
                    const res = preset ? textToPosition(preset.text, index) : null;
                    if (preset && res?.position) {
                        editor.replace(res.position);
                        flash(`Preset: ${preset.title}`);
                    } else if (res) {
                        flash(`Preset failed: ${res.issues[0]?.message}`);
                    }
                }}
                onLoadSaved={(p) => {
                    const res = textToPosition(p.text, index);
                    if (res.position) {
                        editor.replace(res.position);
                        setMode('setup');
                    } else {
                        flash(res.issues[0]?.message ?? 'Could not load');
                    }
                }}
                onDeleteSaved={(id) => {
                    deleteSavedPosition(id);
                    setSavedPositions(listSavedPositions());
                }}
                onResumeAnalysis={resumeAnalysis}
                onSavePosition={() => {
                    const name = editor.position.title || `Position ${new Date().toLocaleString()}`;
                    savePosition(name, positionText);
                    setSavedPositions(listSavedPositions());
                    flash(`Saved "${name}"`);
                }}
                onCopyText={copyText}
                onCopyLink={copyLink}
                onEditCurrent={editCurrent}
                onTitleChange={(t) => editor.setMeta({ title: t || undefined })}
                toast={toast}
            />
            <Box sx={{ flex: 1, minHeight: 0, display: mode === 'setup' ? 'flex' : 'none', backgroundImage: 'linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0.7)), url(/default-background.webp)', backgroundSize: 'cover' }}>
                <Box sx={{ flex: 1, minWidth: 0, p: '8px', minHeight: 0 }}>
                    <BoardEditor
                        editor={editor}
                        index={index}
                        onRequestSearch={requestSearch}
                        onPlay={play}
                        playDisabledReason={playDisabledReason}
                        starting={starting}
                        active={mode === 'setup'}
                    />
                </Box>
                <Box sx={{ width: RAIL_WIDTH, flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: '8px', p: '8px', minHeight: 0, background: 'rgba(0,0,0,0.45)', borderLeft: '1px solid rgba(255,255,255,0.12)' }}>
                    <Inspector editor={editor} index={index} onRequestSearch={requestSearch} />
                    <CardSearch index={index} editor={editor} inputRef={searchRef} onAdded={flash} />
                    <PositionPanel
                        text={positionText}
                        issues={issues}
                        onApplyText={applyText}
                        onCopyText={copyText}
                        onCopyLink={copyLink}
                        collapsed={textCollapsed}
                        onToggle={() => setTextCollapsed(!textCollapsed)}
                    />
                </Box>
            </Box>
            {mode === 'analyse' && (
                <Box sx={{ flex: 1, minHeight: 0 }}>
                    <AnalysisView session={session} index={index} />
                </Box>
            )}
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
