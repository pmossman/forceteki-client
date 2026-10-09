import { expect, test } from '@playwright/test';
import {
    HandoffEvent, isAllowedHandoffOrigin, listenForHandoff, readHandoffHash, readHandoffPayload, readyTargets,
} from '../../src/app/sandbox/_lib/replay/forgeHandoff';
import { GAME_ID } from './replay/syntheticGame';
import { syntheticPayload } from './replay/handoffPayload';

/**
 * Unit tests for "Open in sandbox" (the receiving half, no browser): the URL fragment, the origin allow-list,
 * the payload check, and the listener — which must answer only an allow-listed origin, only the opener, and only
 * with the nonce from its own URL. The fixture is the committed invented game (Alice/Bob, TST cards).
 */

const NONCE = 'nonce-0123456789';

test.describe('readHandoffHash', () => {
    test('reads the nonce and the frame from the fragment', () => {
        expect(readHandoffHash(`#handoff=${NONCE}&frame=42`)).toEqual({ nonce: NONCE, frame: 42 });
        expect(readHandoffHash(`#handoff=${NONCE}`)).toEqual({ nonce: NONCE, frame: null });
    });

    test('is not a handoff without a well-formed nonce', () => {
        expect(readHandoffHash('')).toBeNull();
        expect(readHandoffHash('#pos=abc')).toBeNull();
        expect(readHandoffHash('#handoff=short')).toBeNull();
        expect(readHandoffHash('#handoff=<script>alert(1)</script>')).toBeNull();
    });
});

test.describe('isAllowedHandoffOrigin', () => {
    test('SWU Forge always; localhost labs only in a dev build', () => {
        expect(isAllowedHandoffOrigin('https://swuforge.com', false)).toBe(true);
        expect(isAllowedHandoffOrigin('https://www.swuforge.com', false)).toBe(true);
        expect(isAllowedHandoffOrigin('http://localhost:5540', false)).toBe(false);
        expect(isAllowedHandoffOrigin('http://localhost:5540', true)).toBe(true);
        expect(isAllowedHandoffOrigin('http://127.0.0.1:5540', true)).toBe(true);
    });

    test('nothing that merely looks like SWU Forge or localhost', () => {
        for (const origin of ['http://swuforge.com', 'https://swuforge.com.evil.example', 'https://evil.example', 'https://localhost:5540',
            'http://localhost.evil.example', 'null', '']) {
            expect(isAllowedHandoffOrigin(origin, true), origin).toBe(false);
        }
    });
});

test.describe('readyTargets', () => {
    test('the production origins, plus a local lab named by the referrer in a dev build', () => {
        expect(readyTargets('http://localhost:5540/battle-log/m/x', true)).toEqual(['https://swuforge.com', 'https://www.swuforge.com', 'http://localhost:5540']);
        expect(readyTargets('http://localhost:5540/battle-log/m/x', false)).toEqual(['https://swuforge.com', 'https://www.swuforge.com']);
        expect(readyTargets('https://evil.example/x', true)).toEqual(['https://swuforge.com', 'https://www.swuforge.com']);
        expect(readyTargets('', true)).toEqual(['https://swuforge.com', 'https://www.swuforge.com']);
    });
});

test.describe('readHandoffPayload', () => {
    test('accepts what SWU Forge sends', () => {
        const res = readHandoffPayload(syntheticPayload(3));
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.payload.gameId).toBe(GAME_ID);
            expect(res.payload.frame).toEqual({ step: 3, forgeFrame: 2 });
            expect(res.payload.seats[1].deckName).toBe('Bob deck');
        }
    });

    test('refuses anything else, saying what', () => {
        const p = syntheticPayload();
        expect(readHandoffPayload(null).ok).toBe(false);
        expect(readHandoffPayload({ ...p, format: 'other' }).ok).toBe(false);
        expect(readHandoffPayload({ ...p, version: 2 }).ok).toBe(false);
        expect(readHandoffPayload({ ...p, seats: [p.seats[0]] }).ok).toBe(false);
        expect(readHandoffPayload({ ...p, seats: [p.seats[0], { ...p.seats[1], recording: { v: 9 } }] }).ok).toBe(false);
        expect(readHandoffPayload({ ...p, seats: [p.seats[0], { ...p.seats[1], decklist: { deck: 'x' } }] }).ok).toBe(false);
        expect(readHandoffPayload({ ...p, frame: { step: -1 } }).ok).toBe(false);
        const res = readHandoffPayload({ ...p, frame: undefined });
        expect(res.ok ? '' : res.error).toContain('no frame');
    });
});

test.describe('listenForHandoff', () => {
    const fakeWindow = (opener: object | null) => {
        const listeners: ((e: MessageEvent) => void)[] = [];
        const timers: (() => void)[] = [];
        const win = {
            opener,
            document: { referrer: 'http://localhost:5540/battle-log/m/lobby/prof/game' },
            addEventListener: (_: string, fn: (e: MessageEvent) => void) => listeners.push(fn),
            removeEventListener: (_: string, fn: (e: MessageEvent) => void) => listeners.splice(listeners.indexOf(fn), 1),
            setTimeout: (fn: () => void) => timers.push(fn),
            clearTimeout: () => timers.splice(0),
        };
        const send = (e: Partial<MessageEvent>) => [...listeners].forEach((l) => l(e as MessageEvent));
        return { win, send, listeners, timers };
    };
    const openerWindow = () => {
        const posted: { message: unknown; origin: string }[] = [];
        return { posted, postMessage: (message: unknown, origin: string) => posted.push({ message, origin }) };
    };

    test('says ready to the opener at each allowed origin, and nowhere else', () => {
        const opener = openerWindow();
        const { win } = fakeWindow(opener);
        listenForHandoff({ nonce: NONCE, frame: 3 }, () => undefined, { window: win as never, dev: true });
        expect(opener.posted).toEqual(['https://swuforge.com', 'https://www.swuforge.com', 'http://localhost:5540'].map((origin) => ({
            origin, message: { type: 'sandbox-ready', nonce: NONCE },
        })));
    });

    test('takes the game from an allowed origin, from the opener, with this nonce — once', () => {
        const opener = openerWindow();
        const { win, send, listeners } = fakeWindow(opener);
        const events: HandoffEvent[] = [];
        listenForHandoff({ nonce: NONCE, frame: 3 }, (e) => events.push(e), { window: win as never, dev: true });
        const message = { type: 'sandbox-handoff', nonce: NONCE, payload: syntheticPayload() };
        send({ origin: 'http://localhost:5540', source: opener as never, data: message });
        send({ origin: 'http://localhost:5540', source: opener as never, data: message });
        expect(events.map((e) => e.kind)).toEqual(['payload']);
        expect(listeners).toHaveLength(0);
    });

    test('ignores an origin off the allow-list, another window, and another nonce', () => {
        const opener = openerWindow();
        const { win, send, listeners } = fakeWindow(opener);
        const events: HandoffEvent[] = [];
        listenForHandoff({ nonce: NONCE, frame: 3 }, (e) => events.push(e), { window: win as never, dev: true });
        const message = { type: 'sandbox-handoff', nonce: NONCE, payload: syntheticPayload() };
        send({ origin: 'https://evil.example', source: opener as never, data: message });
        send({ origin: 'https://swuforge.com.evil.example', source: opener as never, data: message });
        send({ origin: 'http://localhost:5540', source: {} as never, data: message });
        send({ origin: 'http://localhost:5540', source: opener as never, data: { ...message, nonce: 'another-nonce-0000' } });
        expect(events).toEqual([]);
        expect(listeners).toHaveLength(1);
    });

    test('a localhost lab is not allowed in a production build', () => {
        const opener = openerWindow();
        const { win, send } = fakeWindow(opener);
        const events: HandoffEvent[] = [];
        listenForHandoff({ nonce: NONCE, frame: 3 }, (e) => events.push(e), { window: win as never, dev: false });
        send({ origin: 'http://localhost:5540', source: opener as never, data: { type: 'sandbox-handoff', nonce: NONCE, payload: syntheticPayload() } });
        expect(events).toEqual([]);
    });

    test('passes on SWU Forge’s refusal, and a payload it can’t read, as errors', () => {
        const opener = openerWindow();
        const a = fakeWindow(opener);
        const events: HandoffEvent[] = [];
        listenForHandoff({ nonce: NONCE, frame: 3 }, (e) => events.push(e), { window: a.win as never, dev: true });
        a.send({ origin: 'http://localhost:5540', source: opener as never, data: { type: 'sandbox-handoff-error', nonce: NONCE, error: 'no longer shared' } });
        const b = fakeWindow(opener);
        listenForHandoff({ nonce: NONCE, frame: 3 }, (e) => events.push(e), { window: b.win as never, dev: true });
        b.send({ origin: 'http://localhost:5540', source: opener as never, data: { type: 'sandbox-handoff', nonce: NONCE, payload: { format: 'nope' } } });
        expect(events.map((e) => (e.kind === 'error' ? e.error : 'payload'))).toEqual(['no longer shared', expect.stringContaining('unknown format')]);
    });

    test('without an opener there is nothing to wait for', () => {
        const { win, listeners } = fakeWindow(null);
        const events: HandoffEvent[] = [];
        listenForHandoff({ nonce: NONCE, frame: 3 }, (e) => events.push(e), { window: win as never, dev: true });
        expect(events.map((e) => e.kind)).toEqual(['error']);
        expect(listeners).toHaveLength(0);
    });

    test('gives up with a reason when SWU Forge never answers', () => {
        const opener = openerWindow();
        const { win, timers, listeners } = fakeWindow(opener);
        const events: HandoffEvent[] = [];
        listenForHandoff({ nonce: NONCE, frame: 3 }, (e) => events.push(e), { window: win as never, dev: true });
        timers[0]();
        expect(events.map((e) => e.kind)).toEqual(['error']);
        expect(listeners).toHaveLength(0);
    });
});
