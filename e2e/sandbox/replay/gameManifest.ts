/**
 * Real double-sided games for the manifest-driven replay suite (replay-games.unit.spec.ts).
 *
 * The fixtures are REAL SWU Forge data (player handles, profile ids), so they live outside the repo (the forks are
 * public) and are only read at test time. Layout of REPLAY_GAMES_DIR (default: the overseer hub's private folder):
 *
 *   manifest.json        one entry per seat per game: { gameId, lobbyId, leader, base, playedAt?, deckFile, exportFile, ... }
 *   decks/<tag>.json     that seat's decklist (SWUDB / SWU Forge deck JSON: leader, base, deck, sideboard)
 *   exports/<tag>.json   that seat's replay page __data.json
 *   REPORT.md            written by the suite (P1/P2 + leader names only, never handles)
 *
 * A game is ready when both seats' export and decklist are present; the others are listed as missing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readSvelteKitData } from '../../../src/app/sandbox/_lib/replay/devalue';

export const GAMES_DIR = process.env.REPLAY_GAMES_DIR
    ?? '/Users/parker/code/overseer-hub/.claude/orchestrator/streams/karabast-board-editor/replay-fixtures';

export interface IManifestEntry {
    gameId: string;
    lobbyId?: string;
    leader?: string;
    base?: string;
    playedAt?: string;
    deckFile: string;
    exportFile: string;
}

export interface IManifestSeat {
    entry: IManifestEntry;
    exportPath: string;
    deckPath: string;
    hasExport: boolean;
    hasDeck: boolean;
}

export interface IManifestGame {
    gameId: string;

    /** first 8 characters of the game id (the fixture files' prefix) */
    tag: string;
    lobbyId: string | null;

    /** 1-based position in its match (lobby), and how many games of that match the manifest lists */
    gameInMatch: number;
    gamesInMatch: number;

    /** the two seats, in manifest order (the first is imported first, so it is P1) */
    seats: IManifestSeat[];
    ready: boolean;

    /** why it isn't ready: 'export missing: exports/x.json', ... */
    missing: string[];
}

export const hasManifest = () => fs.existsSync(path.join(GAMES_DIR, 'manifest.json'));

/** The "Game N" label SWU Forge's page data gives this game within its match, if the export says. */
const gameNumberFromExport = (exportPath: string, gameId: string): number | null => {
    try {
        const nodes = readSvelteKitData(JSON.parse(fs.readFileSync(exportPath, 'utf8')));
        const page = nodes.find((n) => n && typeof n.match === 'object') as { match?: { games?: { gameId?: string; label?: string }[] } } | undefined;
        const label = page?.match?.games?.find((g) => g.gameId === gameId)?.label ?? '';
        const m = /game\s+(\d+)/i.exec(label);
        return m ? Number(m[1]) : null;
    } catch {
        return null;
    }
};

export const readManifest = (dir = GAMES_DIR): IManifestGame[] => {
    const entries = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as IManifestEntry[];
    const byGame = new Map<string, IManifestEntry[]>();
    for (const e of entries) {
        byGame.set(e.gameId, [...(byGame.get(e.gameId) ?? []), e]);
    }
    const games: IManifestGame[] = [];
    for (const [gameId, seatsOf] of byGame) {
        const seats = seatsOf.map((entry) => {
            const exportPath = path.join(dir, entry.exportFile);
            const deckPath = path.join(dir, entry.deckFile);
            return { entry, exportPath, deckPath, hasExport: fs.existsSync(exportPath), hasDeck: fs.existsSync(deckPath) };
        });
        const missing: string[] = [];
        if (seats.length !== 2) {
            missing.push(`the manifest lists ${seats.length} seat(s), not 2`);
        }
        for (const s of seats) {
            if (!s.hasExport) {
                missing.push(`export missing: ${s.entry.exportFile}`);
            }
            if (!s.hasDeck) {
                missing.push(`decklist missing: ${s.entry.deckFile}`);
            }
        }
        games.push({ gameId, tag: gameId.slice(0, 8), lobbyId: seatsOf[0].lobbyId ?? null, gameInMatch: 1, gamesInMatch: 1, seats, ready: missing.length === 0, missing });
    }

    // order within a match: SWU Forge's own "Game N" label when an export is present, else the earliest playedAt
    const played = (g: IManifestGame) => g.seats.map((s) => s.entry.playedAt ?? '').filter(Boolean).sort()[0] ?? '';
    const byLobby = new Map<string, IManifestGame[]>();
    for (const g of games) {
        const key = g.lobbyId ?? g.gameId;
        byLobby.set(key, [...(byLobby.get(key) ?? []), g]);
    }
    for (const list of byLobby.values()) {
        const labelled = list.map((g) => ({ g, n: g.seats.filter((s) => s.hasExport).map((s) => gameNumberFromExport(s.exportPath, g.gameId)).find((n) => n != null) ?? null }));
        labelled.sort((x, y) => (x.n != null && y.n != null ? x.n - y.n : played(x.g).localeCompare(played(y.g))));
        labelled.forEach(({ g, n }, i) => {
            g.gameInMatch = n ?? i + 1;
            g.gamesInMatch = list.length;
        });
    }
    return games.sort((a, b) => (a.lobbyId ?? '').localeCompare(b.lobbyId ?? '') || a.gameInMatch - b.gameInMatch);
};
