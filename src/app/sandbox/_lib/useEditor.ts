'use client';
import { useCallback, useMemo, useReducer } from 'react';
import { Seat } from '../_engine/SandboxEngine';
import { EditorZone, IPosCard, IPosPlayer, IPosition, PILE_ZONES, PileZone, emptyPosition, makeCard } from './position';

export interface ISelection {
    seat: Seat;
    zone: EditorZone;
    uid: string;

    /** set when the selected card is an upgrade on this unit */
    parentUid?: string;
}

/** Where the next card picked in the search goes. 'upgrade' attaches to the selected unit. */
export interface ITarget {
    seat: Seat;
    zone: EditorZone | 'upgrade';
    parentUid?: string;
}

interface IState {
    position: IPosition;
    past: IPosition[];
    future: IPosition[];
    selection: ISelection | null;
    target: ITarget;
}

type Action =
    | { type: 'replace'; position: IPosition; keepHistory?: boolean }
    | { type: 'edit'; fn: (pos: IPosition) => void }
    | { type: 'select'; selection: ISelection | null }
    | { type: 'target'; target: ITarget }
    | { type: 'undo' }
    | { type: 'redo' };

const clone = (p: IPosition): IPosition => structuredClone(p);

const reducer = (state: IState, action: Action): IState => {
    switch (action.type) {
        case 'replace':
            return {
                ...state,
                position: action.position,
                past: action.keepHistory ? [...state.past, state.position].slice(-100) : [],
                future: [],
                selection: null,
            };
        case 'edit': {
            const next = clone(state.position);
            action.fn(next);
            return { ...state, position: next, past: [...state.past, state.position].slice(-100), future: [] };
        }
        case 'select':
            return { ...state, selection: action.selection };
        case 'target':
            return { ...state, target: action.target };
        case 'undo': {
            if (state.past.length === 0) {
                return state;
            }
            const prev = state.past[state.past.length - 1];
            return { ...state, position: prev, past: state.past.slice(0, -1), future: [state.position, ...state.future] };
        }
        case 'redo': {
            if (state.future.length === 0) {
                return state;
            }
            const [next, ...rest] = state.future;
            return { ...state, position: next, past: [...state.past, state.position], future: rest };
        }
    }
};

/** Find a card anywhere in a player's zones (including attached upgrades). */
export const findCard = (pos: IPosition, uid: string):
    { seat: Seat; zone: EditorZone; card: IPosCard; parent?: IPosCard } | null => {
    for (const seat of ['p1', 'p2'] as Seat[]) {
        const p = pos[seat];
        for (const slot of ['leader', 'base'] as const) {
            const c = p[slot];
            if (c?.uid === uid) {
                return { seat, zone: slot, card: c };
            }
            const up = c?.upgrades?.find((u) => u.uid === uid);
            if (c && up) {
                return { seat, zone: slot, card: up, parent: c };
            }
        }
        for (const zone of PILE_ZONES) {
            for (const c of p[zone]) {
                if (c.uid === uid) {
                    return { seat, zone, card: c };
                }
                const up = c.upgrades?.find((u) => u.uid === uid);
                if (up) {
                    return { seat, zone, card: up, parent: c };
                }
            }
        }
    }
    return null;
};

const removeFrom = (p: IPosPlayer, uid: string): IPosCard | null => {
    for (const zone of PILE_ZONES) {
        const i = p[zone].findIndex((c) => c.uid === uid);
        if (i >= 0) {
            return p[zone].splice(i, 1)[0];
        }
        for (const c of p[zone]) {
            const j = c.upgrades?.findIndex((u) => u.uid === uid) ?? -1;
            if (j >= 0) {
                return c.upgrades!.splice(j, 1)[0];
            }
        }
    }
    for (const slot of ['leader', 'base'] as const) {
        const c = p[slot];
        if (c?.uid === uid) {
            p[slot] = null;
            return c;
        }
        const j = c?.upgrades?.findIndex((u) => u.uid === uid) ?? -1;
        if (c && j >= 0) {
            return c.upgrades!.splice(j, 1)[0];
        }
    }
    return null;
};

export const useEditor = (initial?: IPosition) => {
    const [state, dispatch] = useReducer(reducer, undefined, () => ({
        position: initial ?? emptyPosition(),
        past: [],
        future: [],
        selection: null,
        target: { seat: 'p1', zone: 'ground' },
    } as IState));

    const edit = useCallback((fn: (pos: IPosition) => void) => dispatch({ type: 'edit', fn }), []);

    const api = useMemo(() => ({
        replace: (position: IPosition, keepHistory = true) => dispatch({ type: 'replace', position, keepHistory }),
        select: (selection: ISelection | null) => dispatch({ type: 'select', selection }),
        setTarget: (target: ITarget) => dispatch({ type: 'target', target }),
        undo: () => dispatch({ type: 'undo' }),
        redo: () => dispatch({ type: 'redo' }),

        /** Put a card into a zone; leader/base slots are replaced. Returns the new card's uid. */
        place: (seat: Seat, zone: EditorZone, cardName: string, props: Partial<IPosCard> = {}): string => {
            const c = makeCard(cardName, props);
            edit((pos) => {
                if (zone === 'leader' || zone === 'base') {
                    pos[seat][zone] = c;
                } else {
                    pos[seat][zone].push(c);
                }
            });
            return c.uid;
        },
        attach: (parentUid: string, cardName: string) => {
            const c = makeCard(cardName);
            edit((pos) => {
                const found = findCard(pos, parentUid);
                if (found) {
                    found.card.upgrades = [...(found.card.upgrades ?? []), c];
                }
            });
            return c.uid;
        },
        update: (uid: string, patch: Partial<IPosCard>) => edit((pos) => {
            const found = findCard(pos, uid);
            if (found) {
                Object.assign(found.card, patch);
                for (const key of Object.keys(patch) as (keyof IPosCard)[]) {
                    if (patch[key] === undefined || patch[key] === 0 || patch[key] === false) {
                        delete found.card[key];
                    }
                }
            }
        }),

        /** Replace a card in place, keeping its zone and state (damage capped so the new card survives). */
        swap: (uid: string, cardName: string, opts: { maxDamage?: number; dropUpgrades?: boolean } = {}) => edit((pos) => {
            const found = findCard(pos, uid);
            if (!found) {
                return;
            }
            found.card.card = cardName;
            if (opts.maxDamage != null && (found.card.damage ?? 0) > opts.maxDamage) {
                found.card.damage = Math.max(0, opts.maxDamage);
            }
            if (opts.dropUpgrades) {
                delete found.card.upgrades;
            }
        }),

        /** Turn one plain (filler) resource into a named one. */
        nameFillerResource: (seat: Seat, cardName: string, exhausted: boolean) => {
            const c = makeCard(cardName, exhausted ? { exhausted: true } : {});
            edit((pos) => {
                const f = pos[seat].fillerResources;
                if (exhausted) {
                    f.exhausted = Math.max(0, f.exhausted - 1);
                } else {
                    f.ready = Math.max(0, f.ready - 1);
                }
                pos[seat].resources.push(c);
            });
            return c.uid;
        },

        /** Add or remove one token upgrade (shield/experience) on a unit. */
        bumpToken: (uid: string, token: string, delta: number) => edit((pos) => {
            const found = findCard(pos, uid);
            if (!found) {
                return;
            }
            const ups = found.card.upgrades ?? [];
            if (delta > 0) {
                found.card.upgrades = [...ups, makeCard(token)];
            } else {
                const i = ups.map((u) => u.card).lastIndexOf(token);
                if (i >= 0) {
                    ups.splice(i, 1);
                    found.card.upgrades = ups;
                }
            }
        }),
        remove: (uid: string) => {
            edit((pos) => {
                if (!removeFrom(pos.p1, uid)) {
                    removeFrom(pos.p2, uid);
                }
            });
            dispatch({ type: 'select', selection: null });
        },
        move: (uid: string, toSeat: Seat, toZone: PileZone, index?: number) => edit((pos) => {
            const c = removeFrom(pos.p1, uid) ?? removeFrom(pos.p2, uid);
            if (!c) {
                return;
            }
            if (toZone !== 'ground' && toZone !== 'space') {
                delete c.upgrades;
                delete c.damage;
            }
            const list = pos[toSeat][toZone];
            list.splice(index ?? list.length, 0, c);
        }),
        reorder: (seat: Seat, zone: PileZone, uid: string, delta: number) => edit((pos) => {
            const list = pos[seat][zone];
            const i = list.findIndex((c) => c.uid === uid);
            const j = i + delta;
            if (i < 0 || j < 0 || j >= list.length) {
                return;
            }
            [list[i], list[j]] = [list[j], list[i]];
        }),
        setPlayer: (seat: Seat, patch: Partial<IPosPlayer>) => edit((pos) => {
            Object.assign(pos[seat], patch);
        }),
        setMeta: (patch: Partial<Pick<IPosition, 'title' | 'phase' | 'initiative' | 'active'>>) => edit((pos) => {
            Object.assign(pos, patch);
        }),
        swapSides: () => edit((pos) => {
            const p1 = pos.p1;
            pos.p1 = pos.p2;
            pos.p2 = p1;
            pos.initiative = pos.initiative === 'p1' ? 'p2' : 'p1';
            if (pos.active) {
                pos.active = pos.active === 'p1' ? 'p2' : 'p1';
            }
            const flip = (c: IPosCard | null) => {
                if (!c) {
                    return;
                }
                if (c.owner) {
                    c.owner = c.owner === 'p1' ? 'p2' : 'p1';
                }
                c.upgrades?.forEach(flip);
                c.captured?.forEach(flip);
            };
            for (const p of [pos.p1, pos.p2]) {
                flip(p.leader);
                flip(p.base);
                PILE_ZONES.forEach((z) => p[z].forEach(flip));
            }
        }),
    }), [edit]);

    return { ...state, canUndo: state.past.length > 0, canRedo: state.future.length > 0, ...api };
};

export type EditorApi = ReturnType<typeof useEditor>;
