/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GameContext, IGameContextType } from '@/app/_contexts/Game.context';
import { usePopup } from '@/app/_contexts/Popup.context';
import { useDistributionPrompt } from '@/app/_hooks/useDistributionPrompt';
import { IOngoingEffectSummary } from '@/app/_components/_sharedcomponents/Cards/CardTypes';
import { ISandboxSnapshot, Seat, otherSeat, seatLabel } from '../../_engine/SandboxEngine';
import { ISessionApi } from '../../_lib/useSandboxSession';
import { applyPromptPopups } from './promptPopups';

export type ViewMode = 'both' | 'p1' | 'p2';
export type Orientation = 'p1' | 'p2' | 'decider';

/** The input commands the sandbox engine accepts (CONTRACT.md §1); everything else from the board UI is dropped. */
const ENGINE_COMMANDS = new Set(['cardClicked', 'menuButton', 'perCardMenuButton', 'statefulPromptResults']);

const SANDBOX_LOBBY_STATE = {
    isPrivate: true,
    gameOngoing: true,
    gameType: 'sandbox',
    users: [],
    winHistory: null,
};

export interface IBoardFrame {

    /** state handed to the Karabast board components */
    gameState: any;

    /** seat drawn at the bottom of the board (`connectedPlayer`) */
    bottom: Seat;

    /** seat whose decision the board is currently showing, if any */
    acting: Seat | null;
}

/**
 * Builds the single game state the (unchanged) Karabast board components render.
 *
 * - God view (default): the engine's merged `godView` (both hands open, the deciding seat's selection
 *   flags). The board orientation stays put; the decider's prompt is shown on the bottom seat's
 *   prompt slot so the existing prompt UI (popups, action buttons, centre prompt) drives it.
 * - "View as P1/P2": exactly that seat's own view (`views.p1` / `views.p2`).
 */
export const buildBoardFrame = (snapshot: ISandboxSnapshot, viewMode: ViewMode, orientation: Orientation, focusedDecider: Seat | null): IBoardFrame => {
    const deciders = snapshot.deciders ?? [];
    const acting: Seat | null = deciders.length === 0 ? null :
        (focusedDecider && deciders.includes(focusedDecider) ? focusedDecider : deciders[0]);

    if (viewMode !== 'both') {
        const gs = structuredClone(snapshot.views[viewMode]);
        ensureUsers(gs);
        return { gameState: gs, bottom: viewMode, acting: acting === viewMode ? acting : null };
    }

    const gs = structuredClone(snapshot.godView ?? snapshot.views.p1);
    ensureUsers(gs);
    const bottom: Seat = orientation === 'decider' ? (acting ?? 'p1') : orientation;
    if (acting && acting !== bottom && gs.players?.[acting] && gs.players?.[bottom]) {
        // show the decider's prompt in the bottom seat's prompt slot (the board's prompt UI reads it from there)
        gs.players[bottom].promptState = gs.players[acting].promptState;
        gs.players[acting].promptState = { ...(gs.players[acting].promptState ?? {}), buttons: [], menuTitle: '', promptUuid: undefined };
    }
    return { gameState: gs, bottom, acting };
};

const ensureUsers = (gs: any) => {
    for (const id of Object.keys(gs?.players ?? {})) {
        const p = gs.players[id];
        p.user = { ...(p.user ?? {}), username: id === 'p1' ? 'P1' : id === 'p2' ? 'P2' : (p.user?.username ?? p.name ?? id), id };
        p.promptState = p.promptState ?? {};
        p.cardPiles = p.cardPiles ?? {};
    }
    gs.winners = gs.winners ?? [];
};

interface IBridgeProps {
    session: ISessionApi;
    frame: IBoardFrame;

    /** true while a jump is replaying: the board shows a cached frame and must not send input */
    frozen: boolean;
    children: React.ReactNode;
}

/** Supplies Karabast's GameContext from the sandbox engine, so the real board and prompt components run unchanged. */
const SandboxGameBridge: React.FC<IBridgeProps> = ({ session, frame, frozen, children }) => {
    const { openPopup, clearPopups, prunePromptStatePopups } = usePopup();
    const { distributionPromptData, setDistributionPrompt, clearDistributionPrompt, initDistributionPrompt } = useDistributionPrompt();
    const [hoveredChatCardId, setHoveredChatCardId] = useState<string | null>(null);
    const { gameState, bottom, acting } = frame;
    const frozenRef = useRef(frozen);
    frozenRef.current = frozen;

    // translate the shown prompt into Karabast popups whenever it changes
    const promptKey = JSON.stringify([gameState?.players?.[bottom]?.promptState?.promptUuid, gameState?.players?.[bottom]?.promptState?.buttons?.length, acting, bottom]);
    useEffect(() => {
        if (!gameState) {
            return;
        }
        if (!acting || frozen) {
            clearPopups();
            return;
        }
        applyPromptPopups(gameState, bottom, { openPopup, prunePromptStatePopups, clearDistributionPrompt, initDistributionPrompt }, (id) => seatLabel(id as Seat));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [promptKey, frozen]);

    const value: IGameContextType = useMemo(() => {
        const sendGameMessage = (args: any[]) => {
            if (frozenRef.current || !acting) {
                return;
            }
            const command = args[0];
            let rest = args.slice(1);
            if (!ENGINE_COMMANDS.has(command)) {
                return;
            }
            if (command === 'statefulPromptResults') {
                rest = [distributionPromptData, rest[1]];
                clearDistributionPrompt();
            }
            session.act({ seat: acting, command, args: rest });
        };
        return {
            gameState,
            gameMessages: [],
            lobbyState: SANDBOX_LOBBY_STATE,
            bugReportState: null,
            playerReportState: null,
            statsSubmitNotification: null,
            sendMessage: () => undefined,
            sendGameMessage,
            getOpponent: (player: string) => (player === 'p1' ? 'p2' : player === 'p2' ? 'p1' : otherSeat(bottom)),
            connectedPlayer: bottom,
            sendLobbyMessage: () => undefined,
            resetStates: () => undefined,
            getConnectedPlayerPrompt: () => gameState?.players?.[bottom]?.promptState,
            updateDistributionPrompt: (uuid: string, amount: number) => {
                const promptData = gameState?.players?.[bottom]?.promptState?.distributeAmongTargets;
                setDistributionPrompt(uuid, amount, promptData);
            },
            distributionPromptData,
            isSpectator: false,
            lastQueueHeartbeat: 0,
            isAnonymousPlayer: () => true,
            hasChatDisabled: () => true,
            createNewSocket: () => undefined,
            gameIsEnded: () => !!gameState?.winners?.length,
            ongoingEffects: (gameState?.ongoingEffects ?? []) as IOngoingEffectSummary[],
            hoveredChatCard: {
                id: hoveredChatCardId,
                hover: setHoveredChatCardId,
                clear: () => setHoveredChatCardId(null),
            },
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameState, bottom, acting, distributionPromptData, hoveredChatCardId, session.act]);

    return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
};

export default SandboxGameBridge;
