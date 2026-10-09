/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Prompt state -> popups, for the sandbox board.
 *
 * A copy of `handleGameStatePopups` in Game.context.tsx (upstream keeps it private to GameProvider).
 * Kept as close to the original as possible so the sandbox shows exactly the prompts a real game
 * shows; only the sound and spectator handling are dropped.
 */
import { ZoneName } from '@/app/_constants/constants';
import { PopupSource } from '@/app/_components/_sharedcomponents/Popup/Popup.types';
import { hasSelectedCards } from '@/app/_utils/gameStateHelpers';
import { IUIDistributionPromptData } from '@/app/_hooks/useDistributionPrompt';
import { PopupDataMap, PopupType } from '@/app/_contexts/Popup.context';

interface IPopupApi {
    openPopup: <T extends PopupType>(type: T, data: PopupDataMap[T]) => void;
    prunePromptStatePopups: (promptUuid: string) => void;
    clearDistributionPrompt: () => void;
    initDistributionPrompt: (data: IUIDistributionPromptData) => void;
}

const cardSelectableZones = (gamestate: any, connectedPlayerId: string) => {
    const playerState = gamestate.players[connectedPlayerId];
    const opponentId = Object.keys(gamestate.players).find((id) => id !== connectedPlayerId) || '';
    const opponent = gamestate.players[opponentId];
    const zones = [];
    if (playerState?.leaders?.some((leader: any) => leader.selectable) || playerState?.base?.selectable) {
        zones.push(`player-${ZoneName.Base}`);
    }
    for (const zoneName in playerState?.cardPiles) {
        if (playerState.cardPiles[zoneName].some?.((card: any) => card.selectable)) {
            zones.push(`player-${zoneName}`);
        }
    }
    if (opponent?.leaders?.some((leader: any) => leader.selectable) || opponent?.base?.selectable) {
        zones.push(`opponent-${ZoneName.Base}`);
    }
    for (const zoneName in opponent?.cardPiles) {
        if (opponent.cardPiles[zoneName].some?.((card: any) => card.selectable)) {
            zones.push(`opponent-${zoneName}`);
        }
    }
    return zones;
};

export const applyPromptPopups = (gameState: any, connectedPlayerId: string, api: IPopupApi, seatName: (id: string) => string) => {
    const { openPopup, prunePromptStatePopups, clearDistributionPrompt, initDistributionPrompt } = api;
    if (!connectedPlayerId || !gameState?.players?.[connectedPlayerId]) {
        return;
    }
    const promptState = gameState.players[connectedPlayerId].promptState;
    if (promptState) {
        const { buttons = [], menuTitle, promptTitle, promptUuid, selectCardMode, promptType, dropdownListOptions, perCardButtons, displayCards, selectNumber } = promptState;

        prunePromptStatePopups(promptUuid);
        if (promptType === 'actionWindow') {
            clearDistributionPrompt();
            return;
        } else if (promptType === 'distributeAmongTargets') {
            initDistributionPrompt(promptState.distributeAmongTargets);
            return;
        } else if (hasSelectedCards(gameState, ['groundArena', 'spaceArena']) && buttons.length == 2) {
            return;
        } else if (promptType === 'displayCards') {
            const cards = displayCards.map((card: any) => ({ ...card, uuid: card.cardUuid }));
            return openPopup('select', {
                uuid: promptUuid,
                title: promptTitle,
                description: menuTitle,
                cards,
                perCardButtons,
                buttons,
                source: PopupSource.PromptState,
            });
        } else if (promptType === 'passDelay') {
            return openPopup('waitDelay', { uuid: promptUuid, title: menuTitle, buttons, source: PopupSource.PromptState });
        } else if (promptType === 'batchTriggerResolution' && menuTitle && promptUuid && !selectCardMode) {
            const batchData = promptState.batchTriggerResolution ?? {};
            return openPopup('batchTrigger', {
                uuid: promptUuid,
                title: menuTitle,
                sourceCard: batchData.sourceCard,
                remainingCount: batchData.remainingCount,
                buttons,
                source: PopupSource.PromptState,
            });
        } else if (promptType === 'optionalTrigger' && menuTitle && promptUuid && !selectCardMode) {
            return openPopup('optionalTrigger', { uuid: promptUuid, title: menuTitle, buttons, source: PopupSource.PromptState });
        } else if (buttons.length > 0 && menuTitle && promptUuid && !selectCardMode) {
            const promptPopupType = promptType === 'triggerWindow' ? 'actionTrigger' : 'default';
            return openPopup(promptPopupType, { uuid: promptUuid, title: menuTitle, buttons, source: PopupSource.PromptState });
        } else if (promptType === 'number' && selectNumber && menuTitle && promptUuid && !selectCardMode) {
            return openPopup('number', {
                uuid: promptUuid,
                title: promptTitle,
                description: menuTitle,
                min: selectNumber.min,
                max: selectNumber.max,
                source: PopupSource.PromptState,
            });
        } else if (dropdownListOptions?.length > 0 && menuTitle && promptUuid && !selectCardMode) {
            return openPopup('dropdown', {
                uuid: promptUuid,
                title: promptTitle,
                description: menuTitle,
                options: dropdownListOptions,
                source: PopupSource.PromptState,
            });
        }
    }
    const zones = cardSelectableZones(gameState, connectedPlayerId);
    if (zones.length === 1) {
        const opponentId = Object.keys(gameState.players).find((id) => id !== connectedPlayerId) || '';
        const { menuTitle, buttons } = gameState.players[connectedPlayerId].promptState ?? {};
        const pile = (ownerId: string, pileName: 'resources' | 'discard') => openPopup('pile', {
            uuid: `${ownerId}-${pileName}`,
            title: `${seatName(ownerId)} ${pileName === 'resources' ? 'Resources' : 'Discard'}`,
            subtitle: menuTitle,
            cards: gameState?.players[ownerId]?.cardPiles[pileName],
            source: PopupSource.PromptState,
            buttons: buttons ?? [],
        });
        switch (zones[0]) {
            case 'player-resources':
                pile(connectedPlayerId, 'resources');
                break;
            case 'player-discard':
                pile(connectedPlayerId, 'discard');
                break;
            case 'opponent-resources':
                pile(opponentId, 'resources');
                break;
            case 'opponent-discard':
                pile(opponentId, 'discard');
                break;
        }
    }
};
