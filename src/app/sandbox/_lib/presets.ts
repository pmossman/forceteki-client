import { IPosition, emptyPlayer, makeCard } from './position';

export interface IPreset {
    id: string;
    title: string;
    description: string;
    notes?: string;
    build: () => IPosition;
}

const krennicCadBane = (): IPosition => {
    const p1 = emptyPlayer();
    p1.leader = makeCard('director-krennic#amidst-my-achievement');
    // Dagobah Swamp is a Vigilance base, so Cad Bane (Vigilance/Villainy) costs 5 instead of 7.
    p1.base = makeCard('dagobah-swamp');
    p1.resources = [makeCard('cad-bane#impressed-now')];
    p1.fillerResources = { ready: 6, exhausted: 0 };
    p1.ground = [makeCard('atst')];
    // Plot replaces Cad Bane with the top card of the deck.
    p1.deck = [makeCard('pyke-sentinel')];
    p1.fillerDeck = 8;

    const p2 = emptyPlayer();
    p2.leader = makeCard('luke-skywalker#faithful-friend');
    p2.base = makeCard('administrators-tower');
    p2.fillerResources = { ready: 6, exhausted: 0 };
    // AT-ST (6 power) leaves Consular Security Force (3/7) at 1 HP: Cad Bane's When Played can then finish it.
    p2.ground = [makeCard('consular-security-force'), makeCard('battlefield-marine')];
    p2.hand = [makeCard('battlefield-marine')];

    return {
        title: 'Krennic + Cad Bane (Plot)',
        phase: 'action',
        initiative: 'p1',
        p1,
        p2,
    };
};

const kraytDragon = (): IPosition => {
    const p1 = emptyPlayer();
    p1.leader = makeCard('darth-vader#dark-lord-of-the-sith');
    p1.base = makeCard('kestro-city');
    p1.fillerResources = { ready: 8, exhausted: 0 };
    p1.hand = [makeCard('wampa'), makeCard('battlefield-marine')];
    p1.ground = [makeCard('atst', { damage: 2 })];

    const p2 = emptyPlayer();
    p2.leader = makeCard('luke-skywalker#faithful-friend');
    p2.base = makeCard('echo-base');
    p2.fillerResources = { ready: 8, exhausted: 0 };
    p2.ground = [makeCard('krayt-dragon')];

    return {
        title: 'Krayt Dragon (opponent decides)',
        phase: 'action',
        initiative: 'p1',
        p1,
        p2,
    };
};

const shieldsAndExperience = (): IPosition => {
    const p1 = emptyPlayer();
    p1.leader = makeCard('iden-versio#inferno-squad-commander');
    p1.base = makeCard('kestro-city');
    p1.fillerResources = { ready: 6, exhausted: 0 };
    p1.ground = [makeCard('atst', { upgrades: [makeCard('experience'), makeCard('experience')] })];
    p1.hand = [makeCard('dogmatic-shock-squad')];

    const p2 = emptyPlayer();
    p2.leader = makeCard('luke-skywalker#faithful-friend');
    p2.base = makeCard('echo-base');
    p2.fillerResources = { ready: 6, exhausted: 0 };
    p2.ground = [makeCard('consular-security-force', { upgrades: [makeCard('shield')], damage: 3 }), makeCard('wampa', { exhausted: true })];

    return {
        title: 'Shields and Experience',
        phase: 'action',
        initiative: 'p1',
        p1,
        p2,
    };
};

const leadersAndBases = (): IPosition => {
    const p1 = emptyPlayer();
    p1.leader = makeCard('darth-vader#dark-lord-of-the-sith');
    p1.base = makeCard('kestro-city');
    p1.fillerResources = { ready: 20, exhausted: 0 };
    const p2 = emptyPlayer();
    p2.leader = makeCard('luke-skywalker#faithful-friend');
    p2.base = makeCard('echo-base');
    p2.fillerResources = { ready: 20, exhausted: 0 };
    return {
        title: 'Empty board, 20 ready resources each',
        phase: 'action',
        initiative: 'p1',
        p1,
        p2,
    };
};

export const PRESETS: IPreset[] = [
    {
        id: 'krennic-cad-bane',
        title: 'Krennic + Cad Bane (Plot)',
        description: 'Deploy Krennic; order When Deployed vs Plot.',
        notes: 'P1 deploys Director Krennic with Cad Bane (Plot) in resources. Both triggers wait in one window and P1 orders them. ' +
            'Plot first: Krennic can use Cad Bane\'s power, but Cad Bane\'s When Played has already resolved. ' +
            'Krennic first: the AT-ST deals 6 to Consular Security Force, then Cad Bane can defeat it.',
        build: krennicCadBane,
    },
    { id: 'krayt-dragon', title: 'Krayt Dragon (opponent decides)', description: 'A P1 play hands a decision to P2.', build: kraytDragon },
    { id: 'shields-experience', title: 'Shields and Experience', description: 'Tokens, damage and exhausted units.', build: shieldsAndExperience },
    { id: 'empty', title: 'Empty board, 20 resources each', description: 'Leaders and bases only.', build: leadersAndBases },
];

export const DEFAULT_PRESET_ID = 'krennic-cad-bane';
