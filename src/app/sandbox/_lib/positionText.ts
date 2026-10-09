/**
 * Position text <-> engine position object, client-side (POSITION-FORMAT.md §1 grammar).
 *
 * The engine has the authoritative parser and validator; this copy exists so the editor's text box
 * round-trips instantly while typing (no engine call per keystroke). Card names are kept as written
 * here; resolving them to cards happens in position.ts (fromEnginePosition) against the card index.
 */
import { IEnginePosition, IIssue, IPlayerPosition, IUnitEntry, IUpgradeEntry, Seat } from '../_engine/SandboxEngine';

// ---------------- encode ----------------

const seatText = (s: Seat) => (s === 'p1' ? 'P1' : 'P2');

const mods = (list: (string | false | undefined | null)[]) => {
    const m = list.filter(Boolean) as string[];
    return m.length ? ` [${m.join(', ')}]` : '';
};

const attachLines = (u: { upgrades?: IUpgradeEntry[]; captured?: IUpgradeEntry[] }) => [
    ...(u.upgrades ?? []).map((x) => `  + ${x.card}${mods([x.owner && `owner ${seatText(x.owner)}`])}`),
    ...(u.captured ?? []).map((x) => `  captured: ${x.card}${mods([x.owner && `owner ${seatText(x.owner)}`])}`),
];

/** Emit `zone: spec` lines, grouping consecutive identical attachment-free entries as `Nx`. */
const zoneLines = (zone: string, specs: { spec: string; attach: string[] }[]): string[] => {
    const out: string[] = [];
    let i = 0;
    while (i < specs.length) {
        const cur = specs[i];
        let n = 1;
        if (cur.attach.length === 0) {
            while (i + n < specs.length && specs[i + n].spec === cur.spec && specs[i + n].attach.length === 0) {
                n++;
            }
        }
        out.push(`${zone}: ${n > 1 ? `${n}x ` : ''}${cur.spec}`, ...cur.attach);
        i += n;
    }
    return out;
};

const unitSpec = (u: IUnitEntry) => ({
    spec: `${u.card}${mods([u.damage ? `damage ${u.damage}` : null, u.exhausted && 'exhausted', u.owner && `owner ${seatText(u.owner)}`])}`,
    attach: attachLines(u),
});

const playerLines = (p: IPlayerPosition): string[] => {
    const lines: string[] = [];
    if (p.leader) {
        const l = p.leader;
        lines.push(`leader: ${l.card}${mods([
            l.deployed && 'deployed', l.exhausted && 'exhausted', l.damage ? `damage ${l.damage}` : null,
            l.epicActionUsed && 'epic action used', l.flipped && 'flipped',
        ])}`, ...attachLines(l));
    }
    if (p.base) {
        lines.push(`base: ${p.base.card}${mods([p.base.damage ? `damage ${p.base.damage}` : null])}`, ...attachLines(p.base));
    }
    lines.push(...zoneLines('ground', (p.ground ?? []).map(unitSpec)));
    lines.push(...zoneLines('space', (p.space ?? []).map(unitSpec)));
    lines.push(...zoneLines('resource', (p.resources ?? []).map((r) => ({ spec: `${r.card}${mods([r.exhausted && 'exhausted'])}`, attach: [] }))));
    lines.push(...zoneLines('hand', (p.hand ?? []).map((c) => ({ spec: c.card, attach: [] }))));
    lines.push(...zoneLines('deck', (p.deck ?? []).map((c) => ({ spec: c.card, attach: [] }))));
    lines.push(...zoneLines('discard', (p.discard ?? []).map((c) => ({ spec: c.card, attach: [] }))));
    if (p.credits) {
        lines.push(`credits: ${p.credits}`);
    }
    if (p.force) {
        lines.push('force: yes');
    }
    return lines;
};

export const encodePositionText = (pos: IEnginePosition): string => {
    const lines: string[] = [];
    if (pos.title) {
        lines.push(`# ${pos.title}`);
    }
    lines.push(`phase: ${pos.phase}`, `initiative: ${seatText(pos.initiative)}`);
    if (pos.active && pos.active !== pos.initiative) {
        lines.push(`active: ${seatText(pos.active)}`);
    }
    for (const seat of ['p1', 'p2'] as Seat[]) {
        lines.push('', `[${seatText(seat)}]`, ...playerLines(pos[seat]));
    }
    return lines.join('\n') + '\n';
};

// ---------------- decode ----------------

const emptyPlayerPos = (): IPlayerPosition => ({ ground: [], space: [], resources: [], hand: [], deck: [], discard: [] });

const parseSeat = (v: string): Seat | null => {
    const s = v.trim().toLowerCase();
    if (s === 'p1' || s === 'player1' || s === '1') {
        return 'p1';
    }
    if (s === 'p2' || s === 'player2' || s === '2') {
        return 'p2';
    }
    return null;
};

const ZONE_KEYS: Record<string, 'leader' | 'base' | 'ground' | 'space' | 'resources' | 'hand' | 'deck' | 'discard'> = {
    leader: 'leader', base: 'base',
    ground: 'ground', groundarena: 'ground',
    space: 'space', spacearena: 'space',
    resource: 'resources', resources: 'resources',
    hand: 'hand', deck: 'deck', discard: 'discard',
};

interface ISpec {
    count: number;
    name: string;
    damage?: number;
    exhausted?: boolean;
    deployed?: boolean;
    epicActionUsed?: boolean;
    flipped?: boolean;
    owner?: Seat;
}

const parseSpec = (raw: string, line: number, errors: IIssue[], path: string): ISpec | null => {
    let text = raw.trim();
    const spec: ISpec = { count: 1, name: '' };
    const countMatch = /^(\d+)\s*[x×]\s+(.*)$/i.exec(text);
    if (countMatch) {
        spec.count = Number(countMatch[1]);
        text = countMatch[2];
    }
    const modMatch = /^(.*?)\s*\[([^\]]*)\]\s*$/.exec(text);
    if (modMatch) {
        text = modMatch[1];
        for (const rawMod of modMatch[2].split(',').map((m) => m.trim().toLowerCase()).filter(Boolean)) {
            let m: RegExpExecArray | null;
            if ((m = /^damage\s+(\d+)$/.exec(rawMod))) {
                spec.damage = Number(m[1]);
            } else if (rawMod === 'exhausted') {
                spec.exhausted = true;
            } else if (rawMod === 'ready') {
                spec.exhausted = false;
            } else if (rawMod === 'deployed') {
                spec.deployed = true;
            } else if (rawMod === 'epic action used') {
                spec.epicActionUsed = true;
            } else if (rawMod === 'flipped') {
                spec.flipped = true;
            } else if ((m = /^owner\s+(\S+)$/.exec(rawMod)) && parseSeat(m[1])) {
                spec.owner = parseSeat(m[1])!;
            } else {
                errors.push({ path, line, message: `Unknown modifier "${rawMod}"` });
            }
        }
    }
    spec.name = text.trim();
    if (!spec.name || /[[\]]/.test(spec.name)) {
        errors.push({ path, line, message: 'Missing or malformed card name' });
        return null;
    }
    return spec;
};

export interface IDecodedText { position: IEnginePosition; errors: IIssue[]; warnings: IIssue[] }

export const decodePositionText = (text: string): IDecodedText => {
    const errors: IIssue[] = [];
    const warnings: IIssue[] = [];
    const pos: IEnginePosition = { version: 1, phase: 'action', initiative: 'p1', p1: emptyPlayerPos(), p2: emptyPlayerPos() };
    let seat: Seat | null = null;
    let lastAttachable: { upgrades?: IUpgradeEntry[]; captured?: IUpgradeEntry[] } | null = null;
    let lastPath = '';
    let sawContent = false;

    text.split(/\r?\n/).forEach((rawLine, i) => {
        const line = i + 1;
        if (!rawLine.trim()) {
            return;
        }
        const trimmed = rawLine.trim();
        if (trimmed.startsWith('#')) {
            if (!sawContent && !pos.title) {
                pos.title = trimmed.replace(/^#+\s*/, '');
            }
            return;
        }
        sawContent = true;
        const header = /^\[\s*([^\]]+)\s*\]$/.exec(trimmed);
        if (header) {
            seat = parseSeat(header[1]);
            if (!seat) {
                errors.push({ path: '', line, message: `Unknown section "${trimmed}" (use [P1] or [P2])` });
            }
            lastAttachable = null;
            return;
        }
        const indented = /^\s/.test(rawLine);
        if (indented) {
            const attach = /^\+\s*(.*)$/.exec(trimmed);
            const captured = /^captured\s*:\s*(.*)$/i.exec(trimmed);
            if (!attach && !captured) {
                errors.push({ path: '', line, message: 'Indented lines must be "+ Upgrade" or "captured: Card"' });
                return;
            }
            if (!lastAttachable) {
                errors.push({ path: '', line, message: 'Attachment line with nothing to attach to' });
                return;
            }
            const listKey = attach ? 'upgrades' : 'captured';
            const path = `${lastPath}.${listKey}[${(lastAttachable[listKey] ?? []).length}]`;
            const spec = parseSpec((attach ?? captured)![1], line, errors, path);
            if (spec) {
                const list = (lastAttachable[listKey] ??= []);
                for (let k = 0; k < spec.count; k++) {
                    list.push({ card: spec.name, ...(spec.owner ? { owner: spec.owner } : {}) });
                }
            }
            return;
        }
        const kv = /^([A-Za-z ]+?)\s*:\s*(.*)$/.exec(trimmed);
        if (!kv) {
            errors.push({ path: '', line, message: `Can't read this line: "${trimmed}"` });
            return;
        }
        const key = kv[1].toLowerCase().replace(/\s+/g, '');
        const value = kv[2].trim();
        if (!seat) {
            if (key === 'title') {
                pos.title = value;
            } else if (key === 'phase') {
                if (value.toLowerCase() === 'action' || value.toLowerCase() === 'regroup') {
                    pos.phase = value.toLowerCase() as 'action' | 'regroup';
                } else {
                    errors.push({ path: 'phase', line, message: `Unknown phase "${value}" (action or regroup)` });
                }
            } else if (key === 'initiative' || key === 'active') {
                const s = parseSeat(value);
                if (!s) {
                    errors.push({ path: key, line, message: `Expected P1 or P2, got "${value}"` });
                } else if (key === 'initiative') {
                    pos.initiative = s;
                } else {
                    pos.active = s;
                }
            } else if (key === 'version') {
                // accepted, ignored
            } else {
                errors.push({ path: '', line, message: `Unknown setting "${kv[1]}" (or a card line before [P1]/[P2])` });
            }
            return;
        }
        const player = pos[seat as Seat];
        if (key === 'credits') {
            const n = Number(value);
            if (!Number.isInteger(n) || n < 0) {
                errors.push({ path: `${seat}.credits`, line, message: 'credits must be a whole number' });
            } else {
                player.credits = n;
            }
            return;
        }
        if (key === 'force') {
            player.force = /^(yes|true)$/i.test(value);
            return;
        }
        const zone = ZONE_KEYS[key];
        if (!zone) {
            errors.push({ path: '', line, message: `Unknown zone "${kv[1]}"` });
            return;
        }
        const basePath = zone === 'leader' || zone === 'base' ? `${seat}.${zone}` : `${seat}.${zone}[${player[zone].length}]`;
        const spec = parseSpec(value, line, errors, basePath);
        if (!spec) {
            return;
        }
        if (zone === 'leader') {
            player.leader = {
                card: spec.name,
                ...(spec.deployed ? { deployed: true } : {}), ...(spec.exhausted ? { exhausted: true } : {}),
                ...(spec.damage ? { damage: spec.damage } : {}), ...(spec.epicActionUsed ? { epicActionUsed: true } : {}),
                ...(spec.flipped ? { flipped: true } : {}),
            };
            lastAttachable = player.leader;
            lastPath = basePath;
        } else if (zone === 'base') {
            player.base = { card: spec.name, ...(spec.damage ? { damage: spec.damage } : {}) };
            lastAttachable = player.base;
            lastPath = basePath;
        } else {
            for (let k = 0; k < spec.count; k++) {
                const entry: IUnitEntry = {
                    card: spec.name,
                    ...(spec.damage ? { damage: spec.damage } : {}), ...(spec.exhausted ? { exhausted: true } : {}),
                    ...(spec.owner ? { owner: spec.owner } : {}),
                };
                (player[zone] as IUnitEntry[]).push(entry);
                lastAttachable = zone === 'ground' || zone === 'space' ? entry : null;
                lastPath = `${seat}.${zone}[${player[zone].length - 1}]`;
            }
        }
    });

    for (const s of ['p1', 'p2'] as Seat[]) {
        if (!pos[s].leader) {
            warnings.push({ path: `${s}.leader`, message: `${seatText(s)} has no leader (the engine will use a default)` });
        }
        if (!pos[s].base) {
            warnings.push({ path: `${s}.base`, message: `${seatText(s)} has no base (the engine will use a default)` });
        }
    }
    return { position: pos, errors, warnings };
};
