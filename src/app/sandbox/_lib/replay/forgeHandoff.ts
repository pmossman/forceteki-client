/**
 * "Open in sandbox" from SWU Forge's replay viewer: the receiving half.
 *
 * SWU Forge opens `/sandbox#handoff=<nonce>&frame=<step>` in a new window (the sending half is SWU Forge's
 * `src/lib/karabast/replay/sandboxHandoff.ts`). Browser to browser, no server between the two apps:
 *
 *   1. On load, the sandbox posts `{ type: 'sandbox-ready', nonce }` to its opener.
 *   2. SWU Forge answers `{ type: 'sandbox-handoff', nonce, payload }` (or `sandbox-handoff-error` with a reason).
 *   3. The answer is accepted only from an allow-listed origin (SWU Forge, plus localhost in a dev build), only
 *      from the opener window, and only with the nonce in this page's URL. Anything else is ignored, silently.
 *
 * The payload (`format: 'swuforge-sandbox-handoff'`, version 1) is each seat's recording in the shape the importer
 * already reads (a SWU Forge `PersistedTimeline`, both players' handles already replaced), each seat's decklist in
 * the deck JSON shape the decklist boxes take, and the frame: `step` is a frame of the FIRST seat's recording in the
 * importer's own numbering (frame 0 = the base snapshot), `forgeFrame` the viewer's `?f=`.
 */
import { PersistedTimeline, isPersistedTimeline } from './forgeTimeline';

/** Production origins allowed to hand a game over. */
export const HANDOFF_ORIGINS: readonly string[] = ['https://swuforge.com', 'https://www.swuforge.com'];

/** Local SWU Forge labs and dev servers, accepted in a dev build only. */
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

export const isDevBuild = (): boolean => process.env.NODE_ENV !== 'production';

export const isAllowedHandoffOrigin = (origin: string, dev: boolean = isDevBuild()): boolean =>
    HANDOFF_ORIGINS.includes(origin) || (dev && DEV_ORIGIN.test(origin));

export interface IHandoffRequest {
    nonce: string;

    /** the frame in the URL (informational until the payload, which carries its own) */
    frame: number | null;
}

/** `#handoff=<nonce>&frame=<n>` → the request, or null when the URL isn't a handoff. */
export const readHandoffHash = (hash: string): IHandoffRequest | null => {
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const nonce = params.get('handoff');
    if (!nonce || !/^[A-Za-z0-9_-]{8,128}$/.test(nonce)) {
        return null;
    }
    const raw = params.get('frame');
    const frame = raw !== null && /^\d{1,7}$/.test(raw) ? Number(raw) : null;
    return { nonce, frame };
};

export interface IHandoffSeat {
    leader: string | null;
    deckName: string | null;
    recording: PersistedTimeline;

    /** deck JSON ({ metadata, leader, base, deck, sideboard }), as the decklist boxes take it */
    decklist: object;
    decklistSource: string;
}

export interface IHandoffPayload {
    gameId: string;
    seats: [IHandoffSeat, IHandoffSeat];
    frame: { step: number; forgeFrame: number | null };
}

export type ReadPayloadResult = { ok: true; payload: IHandoffPayload } | { ok: false; error: string };

const bad = (error: string): ReadPayloadResult => ({ ok: false, error: `SWU Forge sent something the sandbox can't read: ${error}.` });

/** Check the shape of what SWU Forge sent; nothing is trusted beyond what the importer itself checks after. */
export const readHandoffPayload = (data: unknown): ReadPayloadResult => {
    const doc = data as Record<string, unknown> | null;
    if (!doc || typeof doc !== 'object') {
        return bad('no payload');
    }
    if (doc.format !== 'swuforge-sandbox-handoff' || doc.version !== 1) {
        return bad(`unknown format ${String(doc.format)} v${String(doc.version)}`);
    }
    if (typeof doc.gameId !== 'string' || !Array.isArray(doc.seats) || doc.seats.length !== 2) {
        return bad('expected a game id and two seats');
    }
    const seats: IHandoffSeat[] = [];
    for (const [i, s] of (doc.seats as Record<string, unknown>[]).entries()) {
        if (!s || typeof s !== 'object' || !isPersistedTimeline(s.recording)) {
            return bad(`seat ${i + 1} has no recording`);
        }
        if (!s.decklist || typeof s.decklist !== 'object' || !Array.isArray((s.decklist as { deck?: unknown }).deck)) {
            return bad(`seat ${i + 1} has no decklist`);
        }
        seats.push({
            leader: typeof s.leader === 'string' ? s.leader : null,
            deckName: typeof s.deckName === 'string' ? s.deckName : null,
            recording: s.recording,
            decklist: s.decklist as object,
            decklistSource: typeof s.decklistSource === 'string' ? s.decklistSource : 'filed',
        });
    }
    const f = doc.frame as { step?: unknown; forgeFrame?: unknown } | undefined;
    const step = typeof f?.step === 'number' && Number.isInteger(f.step) && f.step >= 0 ? f.step : null;
    if (step === null) {
        return bad('no frame');
    }
    const forgeFrame = typeof f?.forgeFrame === 'number' && Number.isInteger(f.forgeFrame) ? f.forgeFrame : null;
    return { ok: true, payload: { gameId: doc.gameId, seats: [seats[0], seats[1]], frame: { step, forgeFrame } } };
};

export type HandoffEvent = { kind: 'payload'; payload: IHandoffPayload } | { kind: 'error'; error: string };

/** How long to wait for SWU Forge's answer once the sandbox has said it is ready. */
const ANSWER_TIMEOUT_MS = 60_000;

/**
 * Where "ready" may go: the production origins, plus (dev build) the opener's own origin when it is a local lab —
 * read from the referrer, since a cross-origin opener's location can't be read. postMessage drops a message whose
 * target origin isn't the opener's, so the nonce only ever reaches an allowed origin.
 */
export const readyTargets = (referrer: string, dev: boolean = isDevBuild()): string[] => {
    const targets = new Set(HANDOFF_ORIGINS);
    try {
        const origin = referrer ? new URL(referrer).origin : null;
        if (origin && isAllowedHandoffOrigin(origin, dev)) {
            targets.add(origin);
        }
    } catch {
        // no usable referrer
    }
    return [...targets];
};

interface IHandoffEnv {
    window: Window;
    referrer: string;
    dev: boolean;
}

/**
 * Tell the opener the sandbox is ready and wait for the game. Calls `onEvent` once (the game, or why not), and
 * returns a function that stops listening.
 */
export const listenForHandoff = (request: IHandoffRequest, onEvent: (event: HandoffEvent) => void, env?: Partial<IHandoffEnv>): (() => void) => {
    const win = env?.window ?? window;
    const dev = env?.dev ?? isDevBuild();
    const opener = win.opener as Window | null;
    if (!opener) {
        onEvent({ kind: 'error', error: 'This sandbox link came from SWU Forge, but the SWU Forge window is gone. Open it again from the replay ("Open in sandbox").' });
        return () => undefined;
    }

    let done = false;
    const finish = (event: HandoffEvent) => {
        if (done) {
            return;
        }
        done = true;
        stop();
        onEvent(event);
    };
    const onMessage = (event: MessageEvent) => {
        // ⛔ an origin off the allow-list, a window other than the opener, or another nonce: ignored, silently
        if (!isAllowedHandoffOrigin(event.origin, dev) || event.source !== opener) {
            return;
        }
        const data = event.data as { type?: unknown; nonce?: unknown; payload?: unknown; error?: unknown } | null;
        if (!data || typeof data !== 'object' || data.nonce !== request.nonce) {
            return;
        }
        if (data.type === 'sandbox-handoff') {
            const res = readHandoffPayload(data.payload);
            finish(res.ok ? { kind: 'payload', payload: res.payload } : { kind: 'error', error: res.error });
        } else if (data.type === 'sandbox-handoff-error') {
            finish({ kind: 'error', error: typeof data.error === 'string' ? data.error : 'SWU Forge could not hand this game over.' });
        }
    };
    const timer = win.setTimeout(() => finish({
        kind: 'error',
        error: 'SWU Forge didn\'t send the game. Open it again from the replay ("Open in sandbox"), and keep the replay tab open until the sandbox has it.',
    }), ANSWER_TIMEOUT_MS);
    const stop = () => {
        win.removeEventListener('message', onMessage);
        win.clearTimeout(timer);
    };
    win.addEventListener('message', onMessage);

    for (const origin of readyTargets(env?.referrer ?? win.document.referrer, dev)) {
        try {
            opener.postMessage({ type: 'sandbox-ready', nonce: request.nonce }, origin);
        } catch {
            // a closed opener, or a target origin the browser rejects
        }
    }
    return stop;
};
