'use client';
import React, { useEffect, useMemo, useRef } from 'react';
import { usePopup } from '@/app/_contexts/Popup.context';
import { Box, Tab, Tabs, Typography } from '@mui/material';
import OpponentCardTray from '@/app/_components/Gameboard/OpponentCardTray/OpponentCardTray';
import Board from '@/app/_components/Gameboard/Board/Board';
import PlayerCardTray from '@/app/_components/Gameboard/PlayerCardTray/PlayerCardTray';
import PopupShell from '@/app/_components/_sharedcomponents/Popup/Popup';
import { s3ImageURL } from '@/app/_utils/s3Utils';
import { Seat } from '../_engine/SandboxEngine';
import { CardIndex } from '../_lib/cardIndex';
import { EditorApi } from '../_lib/useEditor';
import { ISessionApi } from '../_lib/useSandboxSession';
import { IValidationIssue } from '../_lib/validate';
import SandboxGameBridge, { IBoardFrame, Orientation, ViewMode, buildBoardFrame, buildEditFrame } from './play/SandboxGameBridge';
import PromptDock from './play/PromptDock';
import StackPanel from './play/StackPanel';
import FrameExplorer from './play/FrameExplorer';
import LogPanel from './play/LogPanel';
import EditBar from './edit/EditBar';
import EditOverlay from './edit/EditOverlay';

export type StageMode = 'edit' | 'play';
export type PanelTab = 'play' | 'position';

interface ISandboxStageProps {
    mode: StageMode;
    session: ISessionApi;
    index: CardIndex;
    editor: EditorApi;
    issues: IValidationIssue[];
    onPlay: () => void;
    playDisabledReason: string | null;
    starting: boolean;
    resumeTitle: string | null;
    viewMode: ViewMode;
    orientation: Orientation;
    focusedDecider: Seat | null;
    onFocusDecider: (s: Seat) => void;
    panelOpen: boolean;
    panelTab: PanelTab;
    onPanelTab: (t: PanelTab) => void;
    positionTab: React.ReactNode;
    onMessage: (msg: string) => void;
}

const PANEL_WIDTH = 'clamp(320px, 25vw, 430px)';

/**
 * One screen for both modes: the real Karabast board (trays, arenas, leader and base, popups), driven by
 * the sandbox engine through SandboxGameBridge. Edit mode shows the edited position live on that board,
 * inert, with edit overlays; Play mode is the hotseat game. The HUD (prompt dock or edit bar, and the side
 * panel with Stack & moves / Position) wraps both.
 */
const SandboxStage: React.FC<ISandboxStageProps> = (props) => {
    const { mode, session, index, editor } = props;
    const snapshot = session.snapshot;
    const boardRef = useRef<HTMLDivElement>(null);
    const lastFrame = useRef<IBoardFrame | null>(null);
    const { clearPopups } = usePopup();

    // popups opened in one mode (e.g. a resource pile while editing) must not linger into the other
    useEffect(() => {
        clearPopups();
    }, [mode, clearPopups]);

    const frame = useMemo(() => {
        if (!snapshot) {
            return null;
        }
        try {
            return mode === 'edit'
                ? buildEditFrame(snapshot, props.orientation === 'p2' ? 'p2' : 'p1')
                : buildBoardFrame(snapshot, props.viewMode, props.orientation, props.focusedDecider);
        } catch (e) {
            console.error('sandbox: could not build the board frame', e);
            return lastFrame.current;
        }
    }, [snapshot, mode, props.viewMode, props.orientation, props.focusedDecider]);
    lastFrame.current = frame;

    const replaying = mode === 'play' && !!session.pendingNodeId;
    const playerIds = Object.keys(frame?.gameState?.players ?? {});
    const boardReady = !!frame && playerIds.includes('p1') && playerIds.includes('p2');
    const tab: PanelTab = props.panelTab;

    const board = (
        <Box
            ref={boardRef}
            sx={{
                flex: 1,
                minHeight: 0,
                position: 'relative',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                backgroundImage: `url(${s3ImageURL('ui/board-background-1.webp')}?v=2)`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                userSelect: 'none',
                opacity: replaying ? 0.85 : 1,
                transition: 'opacity 0.15s',
            }}
            data-testid="sandbox-board"
            data-mode={mode}
            data-bottom-seat={frame?.bottom}
        >
            {boardReady && frame ? (
                <>
                    <Box sx={{ height: '15%' }}>
                        <OpponentCardTray trayPlayer={frame.bottom === 'p1' ? 'p2' : 'p1'} />
                    </Box>
                    <Box sx={{ height: '67%', position: 'relative', zIndex: 2 }}>
                        <Board sidebarOpen={false} />
                    </Box>
                    <Box sx={{ height: '18%' }}>
                        <PlayerCardTray trayPlayer={frame.bottom} />
                    </Box>
                    <PopupShell sidebarOpen={false} />
                    {mode === 'edit' && (
                        <EditOverlay containerRef={boardRef} gameState={frame.gameState} bottom={frame.bottom} editor={editor} index={index} onMessage={props.onMessage} />
                    )}
                </>
            ) : (
                <Typography sx={{ m: 'auto', color: 'rgba(255,255,255,0.6)' }}>
                    {session.status === 'error' ? `The engine could not start: ${session.statusDetail ?? ''}` : 'Setting up the board…'}
                </Typography>
            )}
        </Box>
    );

    const content = (
        <Box sx={{ display: 'flex', height: '100%', minHeight: 0 }} data-testid={mode === 'play' ? 'analysis-view' : 'edit-view'}>
            <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
                {mode === 'play' && snapshot ? (
                    <PromptDock snapshot={snapshot} acting={frame?.acting ?? null} replaying={replaying} viewMode={props.viewMode} onFocusDecider={props.onFocusDecider} />
                ) : (
                    <EditBar
                        editor={editor}
                        issues={props.issues}
                        onPlay={props.onPlay}
                        playDisabledReason={props.playDisabledReason}
                        starting={props.starting}
                        resumeTitle={props.resumeTitle}
                    />
                )}
                {board}
                {session.lastError && mode === 'play' && (
                    <Box
                        onClick={session.clearError}
                        sx={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 30, background: 'rgba(60,0,0,0.92)', border: '1px solid #ff6b6b', borderRadius: '8px', px: 2, py: 0.8, cursor: 'pointer' }}
                        data-testid="engine-error"
                    >
                        <Typography sx={{ fontSize: '0.82rem', m: 0 }}>{session.lastError} <span style={{ opacity: 0.6 }}>(click to dismiss)</span></Typography>
                    </Box>
                )}
            </Box>
            {props.panelOpen && (
                <Box sx={{ width: PANEL_WIDTH, flex: '0 0 auto', display: 'flex', flexDirection: 'column', minHeight: 0, background: 'rgba(0,0,0,0.6)', borderLeft: '1px solid rgba(255,255,255,0.12)' }} data-testid="side-panel">
                    <Tabs
                        value={tab}
                        onChange={(_, v) => props.onPanelTab(v)}
                        variant="fullWidth"
                        sx={{ minHeight: 38, borderBottom: '1px solid rgba(255,255,255,0.12)', '& .MuiTab-root': { color: 'rgba(255,255,255,0.6)', minHeight: 38, fontWeight: 700, letterSpacing: '0.06em' }, '& .Mui-selected': { color: '#fff !important' }, '& .MuiTabs-indicator': { background: 'var(--initiative-blue)' } }}
                    >
                        <Tab value="play" label="Stack & moves" data-testid="tab-play" />
                        <Tab value="position" label="Position" data-testid="tab-position" />
                    </Tabs>
                    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '8px', p: '8px' }}>
                        {tab === 'play' && snapshot && mode === 'play' && (
                            <>
                                <StackPanel
                                    snapshot={snapshot}
                                    index={index}
                                    acting={frame?.acting ?? null}
                                    canAct={!replaying}
                                    onChooseItem={(seat, command, arg) => session.act({ seat, command, args: [arg] })}
                                />
                                <FrameExplorer
                                    tree={snapshot.tree}
                                    currentId={snapshot.nodeId}
                                    pendingId={session.pendingNodeId}
                                    onGoto={session.goto}
                                    onDelete={session.deleteNode}
                                    onPromote={session.promoteNode}
                                    log={snapshot.log}
                                />
                                <LogPanel log={snapshot.log ?? []} errors={snapshot.engineErrors} />
                            </>
                        )}
                        {tab === 'play' && mode === 'edit' && (
                            <Typography sx={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.55)', p: 1 }}>
                                The stack and the move tree appear once you press Play.
                            </Typography>
                        )}
                        {tab === 'position' && props.positionTab}
                    </Box>
                </Box>
            )}
        </Box>
    );

    if (!frame) {
        return content;
    }
    return (
        <SandboxGameBridge session={session} frame={frame} frozen={replaying || mode === 'edit'}>
            {content}
        </SandboxGameBridge>
    );
};

export default SandboxStage;
