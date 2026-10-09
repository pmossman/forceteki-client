'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import OpponentCardTray from '@/app/_components/Gameboard/OpponentCardTray/OpponentCardTray';
import Board from '@/app/_components/Gameboard/Board/Board';
import PlayerCardTray from '@/app/_components/Gameboard/PlayerCardTray/PlayerCardTray';
import PopupShell from '@/app/_components/_sharedcomponents/Popup/Popup';
import { s3ImageURL } from '@/app/_utils/s3Utils';
import { Seat } from '../../_engine/SandboxEngine';
import { CardIndex } from '../../_lib/cardIndex';
import { ISessionApi } from '../../_lib/useSandboxSession';
import { loadPrefs, savePrefs } from '../../_lib/storage';
import SandboxGameBridge, { Orientation, ViewMode, buildBoardFrame } from './SandboxGameBridge';
import PromptDock from './PromptDock';
import StackPanel from './StackPanel';
import FrameExplorer from './FrameExplorer';
import LogPanel from './LogPanel';

interface IAnalysisViewProps {
    session: ISessionApi;
    index: CardIndex | null;
}

const RAIL_WIDTH = 'clamp(320px, 26vw, 430px)';

/** Play both seats on one board (hotseat), with the stack panel and the move tree beside it. */
const AnalysisView: React.FC<IAnalysisViewProps> = ({ session, index }) => {
    const snapshot = session.snapshot;
    const [viewMode, setViewMode] = useState<ViewMode>(() => loadPrefs().viewMode ?? 'both');
    const [orientation, setOrientation] = useState<Orientation>(() => loadPrefs().orientation ?? 'decider');
    const [focusedDecider, setFocusedDecider] = useState<Seat | null>(null);
    const lastFrame = useRef<ReturnType<typeof buildBoardFrame> | null>(null);

    useEffect(() => savePrefs({ viewMode, orientation }), [viewMode, orientation]);

    const frame = useMemo(() => {
        if (!snapshot) {
            return null;
        }
        try {
            return buildBoardFrame(snapshot, viewMode, orientation, focusedDecider);
        } catch (e) {
            console.error('sandbox: could not build the board frame', e);
            return lastFrame.current;
        }
    }, [snapshot, viewMode, orientation, focusedDecider]);
    lastFrame.current = frame;

    if (!snapshot || !frame) {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <Typography sx={{ color: 'rgba(255,255,255,0.6)' }}>Starting the position…</Typography>
            </Box>
        );
    }

    const replaying = !!session.pendingNodeId;
    const playerIds = Object.keys(frame.gameState?.players ?? {});
    const boardReady = playerIds.includes('p1') && playerIds.includes('p2');

    return (
        <SandboxGameBridge session={session} frame={frame} frozen={replaying}>
            <Box sx={{ display: 'flex', height: '100%', minHeight: 0 }} data-testid="analysis-view">
                <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
                    <PromptDock
                        snapshot={snapshot}
                        acting={frame.acting}
                        replaying={replaying}
                        viewMode={viewMode}
                        onViewMode={setViewMode}
                        orientation={orientation}
                        onOrientation={setOrientation}
                        onFocusDecider={setFocusedDecider}
                    />
                    <Box
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
                        data-bottom-seat={frame.bottom}
                    >
                        {boardReady ? (
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
                            </>
                        ) : (
                            <Typography sx={{ m: 'auto', color: 'rgba(255,255,255,0.6)' }}>Waiting for the engine…</Typography>
                        )}
                    </Box>
                    {session.lastError && (
                        <Box
                            onClick={session.clearError}
                            sx={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 30, background: 'rgba(60,0,0,0.92)', border: '1px solid #ff6b6b', borderRadius: '8px', px: 2, py: 0.8, cursor: 'pointer' }}
                            data-testid="engine-error"
                        >
                            <Typography sx={{ fontSize: '0.82rem', m: 0 }}>{session.lastError} <span style={{ opacity: 0.6 }}>(click to dismiss)</span></Typography>
                        </Box>
                    )}
                </Box>
                <Box sx={{ width: RAIL_WIDTH, flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: '8px', p: '8px', minHeight: 0, background: 'rgba(0,0,0,0.55)', borderLeft: '1px solid rgba(255,255,255,0.12)' }}>
                    <StackPanel
                        snapshot={snapshot}
                        index={index}
                        acting={frame.acting}
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
                </Box>
            </Box>
        </SandboxGameBridge>
    );
};

export default AnalysisView;
