/**
 * What SWU Forge's "Open in sandbox" posts (format `swuforge-sandbox-handoff` v1), built from the committed
 * invented game (Alice/Bob, TST cards): each seat's recording, each seat's decklist, and the frame.
 */
import { ALICE_DECK, BOB_DECK, GAME_ID, timelineFor } from './syntheticGame';

export const syntheticPayload = (step = 3) => ({
    format: 'swuforge-sandbox-handoff',
    version: 1,
    gameId: GAME_ID,
    seats: [
        { leader: 'Alice Leader', deckName: 'Alice deck', recording: timelineFor('alice'), decklist: JSON.parse(ALICE_DECK), decklistSource: 'filed' },
        { leader: 'Bob Leader', deckName: 'Bob deck', recording: timelineFor('bob'), decklist: JSON.parse(BOB_DECK), decklistSource: 'filed' },
    ],
    frame: { step, forgeFrame: 2 },
});
