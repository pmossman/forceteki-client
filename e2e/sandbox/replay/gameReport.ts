/**
 * REPORT.md for the manifest-driven replay suite: one summary table, then one section per game (moments,
 * pick-up-able, count mismatches with the cards named, warnings and approximations by category, load failures,
 * findings). Per-game audits are kept as JSON next to it (`.results/<gameId>.json`), so the report always covers
 * every game run so far and lists the ones still missing data. Seats are P1/P2 plus leader names: audits are
 * scrubbed of handles before they get here (gameAudit.ts), and the report checks again.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Seat } from '../../../src/app/sandbox/_engine/SandboxEngine';
import type { IGameAudit } from './gameAudit';
import type { IManifestGame } from './gameManifest';

const SEATS: Seat[] = ['p1', 'p2'];
const P = (s: Seat) => s.toUpperCase();
const cell = (s: string | number) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

export const resultsDir = (dir: string) => path.join(dir, '.results');

export const saveAudit = (dir: string, audit: IGameAudit, suffix = '') => {
    fs.mkdirSync(resultsDir(dir), { recursive: true });
    fs.writeFileSync(path.join(resultsDir(dir), `${audit.gameId}${suffix}.json`), JSON.stringify(audit, null, 1));
};

const errorFile = (dir: string, gameId: string) => path.join(resultsDir(dir), `${gameId}.error.txt`);

/** An audit that crashed (unreadable export, recordings that don't pair, ...): the report says so instead of "not run". */
export const saveAuditError = (dir: string, gameId: string, message: string | null) => {
    fs.mkdirSync(resultsDir(dir), { recursive: true });
    if (message) {
        fs.writeFileSync(errorFile(dir, gameId), message);
    } else if (fs.existsSync(errorFile(dir, gameId))) {
        fs.unlinkSync(errorFile(dir, gameId));
    }
};

export const loadAudit = (dir: string, gameId: string, suffix = ''): IGameAudit | null => {
    const file = path.join(resultsDir(dir), `${gameId}${suffix}.json`);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as IGameAudit : null;
};

const summarizeMoments = (labels: string[] | undefined, max = 6) => {
    if (!labels?.length) {
        return '';
    }
    return labels.length <= max ? labels.join('; ') : `${labels.slice(0, max).join('; ')}; … (${labels.length} in all)`;
};

const countStats = (a: IGameAudit) => {
    const out = {} as Record<Seat, { match: number; total: number; engineMatch: number }>;
    for (const seat of SEATS) {
        const ds = a.momentAudits.map((m) => m.decks[seat]);
        out[seat] = {
            match: ds.filter((d) => d.remainder === d.replay).length,
            total: ds.length,
            engineMatch: ds.filter((d) => d.engine === d.replay).length,
        };
    }
    return out;
};

const fails = (a: IGameAudit) => a.findings.filter((f) => f.severity === 'fail');

const gameSection = (a: IGameAudit, swapped: IGameAudit | null): string[] => {
    const out: string[] = [];
    const counts = countStats(a);
    const loaded = a.momentAudits.filter((m) => m.loaded).length;
    const deciderOk = a.momentAudits.filter((m) => m.loaded && [...(m.deciders ?? [])].sort().join() === [...m.expectedDeciders].sort().join()).length;
    const draws = { ok: 0, failed: 0, skipped: 0 };
    for (const m of a.momentAudits) {
        draws[m.draw.status]++;
    }
    const match = a.gamesInMatch > 1 ? `game ${a.gameInMatch} of ${a.gamesInMatch} in its match` : 'single game';
    out.push(`## ${a.tag} · P1 ${a.seats.p1.leader} vs P2 ${a.seats.p2.leader} (${match})`, '');
    out.push('| | |', '|---|---|');
    out.push(`| Recordings aligned | ${a.alignment.matchedRuns} of ${Math.max(a.alignment.runsA, a.alignment.runsB)} runs (${a.alignment.mode}; P1's recording ${a.alignment.runsA} runs, P2's ${a.alignment.runsB}) |`);
    out.push(`| Moments | ${a.moments}, of which ${a.clean} pick-up-able |`);
    for (const seat of SEATS) {
        const c = counts[seat];
        out.push(`| ${P(seat)} deck counts | remainder = replay at ${c.match}/${c.total} moments; engine deck = replay at ${c.engineMatch}/${c.total} |`);
    }
    out.push(`| Loaded in the engine | ${loaded}/${a.momentAudits.length} (seat to act right: ${deciderOk}/${loaded}) |`);
    out.push(`| Draw from the remainder | ${draws.ok} ok, ${draws.failed} failed, ${draws.skipped} not reached |`);
    out.push(`| Failures | ${fails(a).length ? `**${fails(a).length}**` : '0'} |`);
    if (swapped) {
        const sc = countStats(swapped);
        out.push(`| Swapped import (P1 ↔ P2) | ${swapped.clean} pick-up-able of ${swapped.moments}; counts match ${sc.p1.match}/${sc.p1.total} and ${sc.p2.match}/${sc.p2.total}; ${fails(swapped).length} failure(s) |`);
    }
    out.push(`| Run | ${(a.durationMs / 1000).toFixed(1)} s, ${a.generatedAt.slice(0, 16).replace('T', ' ')} UTC |`, '');

    out.push('**Decklists**', '');
    out.push('| Seat | Leader | Base | Decklist main / side | Deck played (replay start) | Leader / base match | Export deck version | Seen beyond the main deck |');
    out.push('|---|---|---|---|---|---|---|---|');
    for (const seat of SEATS) {
        const s = a.seats[seat];
        const beyond = s.beyondMain.length
            ? s.beyondMain.map((x) => `${x.name} ×${x.count}${x.inSideboard ? ` (sideboard has ${x.inSideboard})` : ' (not in the sideboard)'}`).join(', ')
            : 'none';
        out.push(`| ${P(seat)} | ${cell(s.leader)} | ${cell(s.base)} | ${s.decklistSize} / ${s.sideboardSize} | ${s.startingDeckCount} | ${s.leaderMatches ? 'yes' : '**no**'} / ${s.baseMatches ? 'yes' : '**no**'} | ${s.exportDeckVersion ?? '-'} | ${cell(beyond)} |`);
    }
    out.push('');

    // count mismatches, grouped by what's named
    const mism: string[] = [];
    for (const seat of SEATS) {
        const groups = new Map<string, string[]>();
        for (const m of a.momentAudits) {
            const d = m.decks[seat];
            if (d.remainder === d.replay) {
                continue;
            }
            const named = d.beyond.length ? `; on the board beyond the list: ${d.beyond.map((x) => `${x.name}${x.count > 1 ? ` ×${x.count}` : ''}`).join(', ')}` : '';
            const key = `remainder ${d.remainder - d.replay > 0 ? '+' : ''}${d.remainder - d.replay}${named}`;
            groups.set(key, [...(groups.get(key) ?? []), m.label]);
        }
        for (const [key, labels] of groups) {
            mism.push(`| ${P(seat)} | ${cell(key)} | ${labels.length} | ${cell(summarizeMoments(labels, 3))} |`);
        }
    }
    out.push('**Deck count mismatches**', '');
    if (mism.length) {
        out.push('| Seat | Remainder vs replay | Moments | Where |', '|---|---|---|---|', ...mism);
    } else {
        out.push('None: every remainder equals the replay\'s deck count.');
    }
    out.push('');

    out.push('**Warnings and approximations by category** (moments each appears in)', '');
    if (a.categories.length) {
        out.push('| Kind | Category | Moments | Example |', '|---|---|---|---|');
        for (const c of a.categories) {
            out.push(`| ${c.kind} | ${cell(c.category)} | ${c.moments}/${a.momentAudits.length} | ${cell(c.example.length > 160 ? `${c.example.slice(0, 157)}…` : c.example)} |`);
        }
    } else {
        out.push('None.');
    }
    out.push('');

    const loadFails = a.momentAudits.filter((m) => !m.loaded);
    out.push('**Load failures**', '');
    out.push(loadFails.length ? loadFails.map((m) => `- ${m.label}: ${m.loadErrors.join('; ') || 'no engine'}`).join('\n') : 'None.');
    out.push('');

    out.push('**Findings**', '');
    if (a.findings.length) {
        const order = { fail: 0, limitation: 1, info: 2 } as const;
        for (const f of [...a.findings].sort((x, y) => order[x.severity] - order[y.severity])) {
            const tag = f.severity === 'fail' ? '**FAIL**' : f.severity === 'limitation' ? 'data limitation' : 'note';
            const where = f.moments?.length ? ` (${summarizeMoments(f.moments, 4)})` : '';
            out.push(`- ${tag} · ${f.category}: ${f.message}${where}`);
        }
    } else {
        out.push('None.');
    }
    out.push('');
    return out;
};

export const renderReport = (games: IManifestGame[], dir: string, meta: { client: string; engine: string }): string => {
    const audits = new Map<string, { a: IGameAudit | null; s: IGameAudit | null }>();
    for (const g of games) {
        audits.set(g.gameId, { a: g.ready ? loadAudit(dir, g.gameId) : null, s: g.ready ? loadAudit(dir, g.gameId, '.swapped') : null });
    }
    const out: string[] = [];
    out.push('# Replay "pick up from here": real double-sided games', '');
    out.push(`Generated by \`e2e/sandbox/replay-games.unit.spec.ts\` (${meta.client}; engine: ${meta.engine}). Seats are P1/P2 (P1 = the first manifest seat, imported first) with leader names; no player handles.`, '');
    out.push('Checks at every pick-up-able moment: (a) each remainder equals the replay\'s deck count, and the import accounts for exactly the cards that left each deck; (b) every remainder card is in that seat\'s decklist (reprints resolve to the same card); (c) the position loads in the engine (Worker build) with the right seat(s) to act and the remainders as its decks; (d) playing on to the next draw, each seat draws the top of its rebuilt deck. A **FAIL** is an importer/engine problem; a data limitation is explained by the data (e.g. a decklist that is not the version played).', '');

    out.push('## Summary', '');
    out.push('| Game | Match | P1 vs P2 | Aligned runs | Moments | Pick-up-able | Counts match P1 / P2 | Loaded | Draw ok | Failures | Data limitations |');
    out.push('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const g of games) {
        const { a } = audits.get(g.gameId)!;
        const match = g.gamesInMatch > 1 ? `${g.gameInMatch}/${g.gamesInMatch}` : '1/1';
        const crashed = g.ready && fs.existsSync(errorFile(dir, g.gameId)) ? fs.readFileSync(errorFile(dir, g.gameId), 'utf8') : null;
        if (!a || crashed) {
            const leaders = g.seats.map((s) => s.entry.leader ?? '?').join(' vs ');
            const status = crashed ? `**audit failed**: ${crashed}` : g.ready ? 'not run yet' : g.missing.join('; ');
            out.push(`| ${g.tag} | ${match} | ${leaders} | ${cell(status)} | | | | | | ${crashed ? '**1**' : ''} | |`);
            continue;
        }
        const c = countStats(a);
        const limits = [...new Set(a.findings.filter((f) => f.severity === 'limitation').map((f) => f.category))];
        out.push(`| ${a.tag} | ${match} | ${cell(a.title)} | ${a.alignment.matchedRuns}/${Math.max(a.alignment.runsA, a.alignment.runsB)} | ${a.moments} | ${a.clean} | ${c.p1.match}/${c.p1.total} · ${c.p2.match}/${c.p2.total} | ${a.momentAudits.filter((m) => m.loaded).length}/${a.momentAudits.length} | ${a.momentAudits.filter((m) => m.draw.status === 'ok').length}/${a.momentAudits.length} | ${fails(a).length ? `**${fails(a).length}**` : '0'} | ${cell(limits.join('; ') || 'none')} |`);
    }
    out.push('');

    const missing = games.filter((g) => !g.ready);
    if (missing.length) {
        out.push('## Not run: export missing', '');
        for (const g of missing) {
            out.push(`- ${g.tag} (${g.seats.map((s) => s.entry.leader ?? '?').join(' vs ')}): ${g.missing.join('; ')}`);
        }
        out.push('');
    }

    for (const g of games) {
        const { a, s } = audits.get(g.gameId)!;
        if (a && !fs.existsSync(errorFile(dir, g.gameId))) {
            out.push(...gameSection(a, s));
        }
    }
    return `${out.join('\n')}\n`;
};

export const writeReport = (games: IManifestGame[], dir: string, meta: { client: string; engine: string }, forbidden: RegExp[] = []) => {
    const text = renderReport(games, dir, meta);
    const leaked = forbidden.filter((re) => new RegExp(re.source).test(text));
    if (leaked.length) {
        throw new Error(`REPORT.md would hold ${leaked.length} player handle(s); not written`);
    }
    fs.writeFileSync(path.join(dir, 'REPORT.md'), text);
    return text;
};
