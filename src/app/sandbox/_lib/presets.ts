/**
 * Built-in positions, as position text. Krennic, Iden and the empty board are the engine's own presets
 * (forceteki server/sandbox/SandboxPresets.ts, each checked by an engine spec); they are kept here too
 * so the editor works as a static page without asking a server.
 */
export interface IPreset {
    id: string;
    title: string;
    description: string;
    text: string;
}

const lines = (...l: string[]) => l.join('\n') + '\n';

export const PRESETS: IPreset[] = [
    {
        id: 'krennic-cad-bane',
        title: 'Krennic + Cad Bane (Plot)',
        description: 'Deploy Krennic; P1 orders When Deployed vs Plot. Try both orders.',
        text: lines(
            '# Krennic + Cad Bane (Plot)',
            'phase: action',
            'initiative: P1',
            '',
            '[P1]',
            'leader: Director Krennic, Amidst My Achievement',
            'base: Dagobah Swamp',
            'ground: AT-ST',
            'resource: Cad Bane, Impressed Now?',
            'resource: 6x Underworld Thug',
            'hand: Battlefield Marine',
            'deck: Pyke Sentinel',
            'deck: 5x Underworld Thug',
            '',
            '[P2]',
            'leader: Luke Skywalker, Faithful Friend',
            'base: Administrator\'s Tower',
            'ground: Consular Security Force',
            'ground: Battlefield Marine [damage 1]',
            'resource: 4x Underworld Thug',
            'hand: Wampa',
            'deck: 5x Underworld Thug',
        ),
    },
    {
        id: 'iden-plot-krayt',
        title: 'Iden Versio + two Plots vs Krayt Dragon',
        description: 'Three triggers to order; P2\'s Krayt Dragon decides inside the nested layers.',
        text: lines(
            '# Iden Versio + two Plots vs Krayt Dragon',
            'phase: action',
            'initiative: P1',
            '',
            '[P1]',
            'leader: Iden Versio, Inferno Squad Commander',
            'base: Dagobah Swamp',
            'resource: Dogmatic Shock Squad',
            'resource: Cad Bane, Impressed Now?',
            'resource: 14x Wampa',
            'deck: Pyke Sentinel',
            'deck: Moisture Farmer',
            'deck: 4x Underworld Thug',
            '',
            '[P2]',
            'leader: Luke Skywalker, Faithful Friend',
            'base: Administrator\'s Tower',
            'ground: Battlefield Marine [damage 1]',
            'ground: Krayt Dragon',
            'resource: 4x Underworld Thug',
            'deck: 5x Underworld Thug',
        ),
    },
    {
        id: 'shields-experience',
        title: 'Shields, Experience and damage',
        description: 'Per-card state: tokens, damage, exhausted units, a stolen unit.',
        text: lines(
            '# Shields, Experience and damage',
            'phase: action',
            'initiative: P1',
            '',
            '[P1]',
            'leader: Darth Vader, Dark Lord of the Sith',
            'base: Kestro City',
            'ground: AT-ST',
            '  + Experience',
            '  + Experience',
            'ground: Wampa [owner P2]',
            'resource: 6x Underworld Thug',
            'hand: Battlefield Marine',
            'deck: 6x Underworld Thug',
            '',
            '[P2]',
            'leader: Luke Skywalker, Faithful Friend',
            'base: Administrator\'s Tower [damage 8]',
            'ground: Consular Security Force [damage 3]',
            '  + Shield',
            'ground: Battlefield Marine [exhausted]',
            'resource: 6x Underworld Thug',
            'deck: 6x Underworld Thug',
        ),
    },
    {
        id: 'empty-board',
        title: 'Empty board, 10 ready resources each',
        description: 'Leaders and bases only, with 10 ready resources and a small deck each.',
        text: lines(
            '# Empty board',
            'phase: action',
            'initiative: P1',
            '',
            '[P1]',
            'leader: Darth Vader, Dark Lord of the Sith',
            'base: Kestro City',
            'resource: 10x Underworld Thug',
            'deck: 10x Underworld Thug',
            '',
            '[P2]',
            'leader: Luke Skywalker, Faithful Friend',
            'base: Administrator\'s Tower',
            'resource: 10x Underworld Thug',
            'deck: 10x Underworld Thug',
        ),
    },
];

export const DEFAULT_PRESET_ID = 'krennic-cad-bane';
