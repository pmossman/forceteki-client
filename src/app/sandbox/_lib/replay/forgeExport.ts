/**
 * One SWU Forge recording, read from what a person can save in the browser:
 *
 *  - the replay page's `__data.json` (`/battle-log/m/<lobby>/<recorder>/<game>/__data.json`): SvelteKit page data,
 *    devalue-flattened. The recording is `game.rawEvents`, a `PersistedTimeline` (one normalized gamestate plus
 *    per-step patches). It is ONE seat's recording: only the recorder's own hand and resources are visible.
 *    `doubleSided.available` says whether the opponent recorded the same game too.
 *  - the "both sides" endpoint's JSON (`.../games/<game>/opposite`): `{ oppPlayerId, alignment, timeline,
 *    cardCatalog }`, i.e. the opponent's recording of the same game.
 *  - a bare `PersistedTimeline`.
 *
 * Neither export carries a decklist: the page nulls `game.deckVersion` and only names the recorder's deck.
 */
import { readSvelteKitData } from './devalue';
import { IFrame, PersistedTimeline, expandTimeline, identifyRecorderId, isPersistedTimeline } from './forgeTimeline';

export type RecordingSource = 'replayPage' | 'oppositeEndpoint' | 'timeline';

export interface IForgeRecording {
    source: RecordingSource;

    /** karabast game id (from the gamestate) */
    gameId: string;

    /** gamestate player id of the seat that recorded this (its hand is visible) */
    recorderId: string;

    /** both gamestate player ids */
    playerIds: [string, string];

    /** the page's double-sided flag: false = SWU Forge has no recording of the other seat */
    doubleSidedAvailable: boolean | null;

    /** the recorder's SWU Forge deck name, when the page names it (display only) */
    deckName: string | null;
    timeline: PersistedTimeline;
    frames: IFrame[];
}

export type ParseRecordingResult = { ok: true; recording: IForgeRecording } | { ok: false; error: string };

export const SINGLE_SIDED_REFUSAL =
    'This replay is single-sided: SWU Forge has only one player\'s recording of this game, so the opponent\'s hand, ' +
    'resources and deck order were never seen. "Pick up from here" needs both seats (double-sided replays only), ' +
    'so the remainder of BOTH decks can be worked out. Try a game where both players recorded with Kara Tracker.';

const fail = (error: string): ParseRecordingResult => ({ ok: false, error });

export const recordingFrom = (timeline: PersistedTimeline, source: RecordingSource, extra: { doubleSidedAvailable: boolean | null; deckName: string | null }): ParseRecordingResult => {
    const frames = expandTimeline(timeline);
    const players = Object.keys(timeline.base?.players ?? {});
    if (players.length !== 2) {
        return fail(`The recording has ${players.length} players; only two-player games can be imported.`);
    }
    const recorderId = identifyRecorderId(frames);
    if (!recorderId || !players.includes(recorderId)) {
        return fail('Could not tell whose recording this is (no face-up hand in any frame).');
    }
    const gameId = timeline.base.gameId ?? frames.find((f) => f.gamestate.gameId)?.gamestate.gameId ?? null;
    if (!gameId) {
        return fail('The recording has no game id.');
    }
    return {
        ok: true,
        recording: { source, gameId, recorderId, playerIds: [players[0], players[1]], timeline, frames, ...extra },
    };
};

/**
 * Read one file. `refuseSingleSided` (default true) refuses a replay page whose game SWU Forge marks as
 * single-sided, with the reason.
 */
export const parseForgeRecording = (raw: string | unknown, options: { refuseSingleSided?: boolean } = {}): ParseRecordingResult => {
    let json: unknown = raw;
    if (typeof raw === 'string') {
        try {
            json = JSON.parse(raw);
        } catch {
            return fail('That is not JSON. Save the replay page\'s __data.json (or the "both sides" JSON) and import that file.');
        }
    }
    if (!json || typeof json !== 'object') {
        return fail('That file is not a SWU Forge replay export.');
    }
    const doc = json as Record<string, unknown>;

    // 1. SvelteKit page data (__data.json)
    if (doc.type === 'data' && Array.isArray(doc.nodes)) {
        let nodes: (Record<string, unknown> | null)[];
        try {
            nodes = readSvelteKitData(doc);
        } catch (e) {
            return fail(`Could not decode the page data: ${(e as Error).message}`);
        }
        const page = nodes.find((n) => n && typeof n.game === 'object' && n.game !== null) as Record<string, unknown> | undefined;
        if (!page) {
            return fail('This page data has no game in it. Open a single game\'s replay on SWU Forge (not the match page) and save that page\'s __data.json.');
        }
        const game = page.game as Record<string, unknown>;
        const doubleSided = page.doubleSided as { available?: unknown } | undefined;
        const available = typeof doubleSided?.available === 'boolean' ? doubleSided.available : null;
        if (options.refuseSingleSided !== false && available === false) {
            return fail(SINGLE_SIDED_REFUSAL);
        }
        if (!isPersistedTimeline(game.rawEvents)) {
            return fail(Array.isArray(game.rawEvents)
                ? 'This replay is stored as raw socket frames (an old recording format); only compact recordings can be imported.'
                : 'This page data has no recording in it (game.rawEvents is missing).');
        }
        const deck = page.deck as { name?: unknown } | undefined;
        return recordingFrom(game.rawEvents, 'replayPage', {
            doubleSidedAvailable: available,
            deckName: typeof deck?.name === 'string' ? deck.name : null,
        });
    }

    // 2. the "both sides" endpoint
    if (isPersistedTimeline(doc.timeline) && typeof doc.oppPlayerId === 'string') {
        return recordingFrom(doc.timeline, 'oppositeEndpoint', { doubleSidedAvailable: true, deckName: null });
    }

    // 3. a bare persisted timeline
    if (isPersistedTimeline(doc)) {
        return recordingFrom(doc, 'timeline', { doubleSidedAvailable: null, deckName: null });
    }
    return fail('That file is not a SWU Forge replay export (expected a replay page\'s __data.json).');
};
