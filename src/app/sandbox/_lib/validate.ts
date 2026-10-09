/**
 * Instant client-side position checks (DESIGN §2.3). The engine stays authoritative: whatever it
 * rejects on load is shown too. Errors block "Play"; warnings are informational.
 */
import { Seat, seatLabel } from '../_engine/SandboxEngine';

export interface IValidationIssue { path: string; message: string; severity: 'error' | 'warning'; line?: number }
import { CardIndex, cardKind, displayName } from './cardIndex';
import { IPosCard, IPosition, PILE_ZONES, PileZone, ZONE_LABELS, resourceCount } from './position';

const zoneAllows = (kind: string, zone: PileZone, arena?: string): string | null => {
    const isToken = kind === 'tokenUnit' || kind === 'tokenUpgrade' || kind === 'token';
    if (kind === 'leader' || kind === 'base') {
        return `a ${kind} can't be in ${ZONE_LABELS[zone].toLowerCase()}`;
    }
    if (isToken && zone !== 'ground' && zone !== 'space') {
        return 'tokens can only be in play';
    }
    if (zone === 'ground' || zone === 'space') {
        if (kind !== 'unit' && kind !== 'tokenUnit') {
            return 'only units can be in an arena';
        }
        const want = zone === 'ground' ? 'ground' : 'space';
        if (arena && arena !== want) {
            return `it's a ${arena} unit`;
        }
    }
    return null;
};

export const validatePosition = (pos: IPosition, index: CardIndex | null): IValidationIssue[] => {
    const issues: IValidationIssue[] = [];
    if (!index) {
        return issues;
    }
    const err = (path: string, message: string) => issues.push({ path, message, severity: 'error' });
    const warn = (path: string, message: string) => issues.push({ path, message, severity: 'warning' });

    for (const seat of ['p1', 'p2'] as Seat[]) {
        const p = pos[seat];
        const who = seatLabel(seat);
        const uniques = new Map<string, number>();
        const countUnique = (c: IPosCard) => {
            const card = index.get(c.card);
            if (card?.unique) {
                uniques.set(card.name, (uniques.get(card.name) ?? 0) + 1);
            }
        };

        if (!p.leader) {
            err(`${seat}.leader`, `${who} has no leader`);
        } else {
            const leader = index.get(p.leader.card);
            if (!leader) {
                err(`${seat}.leader`, `${who}: unknown card "${p.leader.card}"`);
            } else if (cardKind(leader) !== 'leader') {
                err(`${seat}.leader`, `${who}: ${displayName(leader)} is not a leader`);
            }
            if (!p.leader.deployed && (p.leader.damage || p.leader.upgrades?.length)) {
                err(`${seat}.leader`, `${who}: an undeployed leader can't have damage or upgrades`);
            }
            if (p.leader.deployed && leader?.hp != null && (p.leader.damage ?? 0) >= leader.hp) {
                err(`${seat}.leader`, `${who}: ${leader.title} would be defeated (damage ≥ HP)`);
            }
            if (p.leader.deployed) {
                countUnique(p.leader);
            }
        }
        if (!p.base) {
            err(`${seat}.base`, `${who} has no base`);
        } else {
            const base = index.get(p.base.card);
            if (!base) {
                err(`${seat}.base`, `${who}: unknown card "${p.base.card}"`);
            } else if (cardKind(base) !== 'base') {
                err(`${seat}.base`, `${who}: ${displayName(base)} is not a base`);
            } else if (base.hp != null && (p.base.damage ?? 0) >= base.hp) {
                err(`${seat}.base`, `${who}: base damage ≥ HP (the game would already be over)`);
            }
        }

        for (const zone of PILE_ZONES) {
            p[zone].forEach((c, i) => {
                const path = `${seat}.${zone}[${i}]`;
                const card = index.get(c.card);
                if (!card) {
                    err(path, `${who}: unknown card "${c.card}"`);
                    return;
                }
                const why = zoneAllows(cardKind(card), zone, card.arena);
                if (why) {
                    err(path, `${who} ${ZONE_LABELS[zone]}: ${displayName(card)}: ${why}`);
                }
                if (zone === 'ground' || zone === 'space') {
                    countUnique(c);
                    let hp = card.hp ?? 0;
                    for (const u of c.upgrades ?? []) {
                        const up = index.get(u.card);
                        if (!up) {
                            err(path, `${who}: unknown upgrade "${u.card}"`);
                            continue;
                        }
                        const k = cardKind(up);
                        if (k !== 'upgrade' && k !== 'tokenUpgrade' && !(up.keywords ?? []).includes('piloting')) {
                            err(path, `${who}: ${displayName(up)} is not an upgrade`);
                        }
                        hp += up.upgradeHp ?? 0;
                        if (up.unique) {
                            uniques.set(up.name, (uniques.get(up.name) ?? 0) + 1);
                        }
                    }
                    if ((c.damage ?? 0) >= hp && hp > 0) {
                        err(path, `${who}: ${card.title} would be defeated (damage ${c.damage} ≥ HP ${hp})`);
                    }
                }
            });
        }

        for (const [name, count] of uniques) {
            if (count > 1) {
                err(`${seat}`, `${who} controls ${count} copies of unique ${displayName(index.get(name)!)}`);
            }
        }

        if (p.deck.length + p.fillerDeck === 0) {
            warn(`${seat}.deck`, `${who}'s deck is empty: drawing will damage their base`);
        }
        if (p.leader && !p.leader.deployed) {
            const leader = index.get(p.leader.card);
            const epicMatch = leader?.epicAction?.match(/(\d+) or more resources/);
            if (epicMatch && resourceCount(p) < Number(epicMatch[1])) {
                warn(`${seat}.resources`, `${who} has fewer than ${epicMatch[1]} resources: ${leader!.title} can't deploy yet`);
            }
        }
    }
    return issues;
};
