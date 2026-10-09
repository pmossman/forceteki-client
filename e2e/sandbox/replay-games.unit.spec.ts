import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { IGameAudit, auditGame, handlePatterns } from './replay/gameAudit';
import { GAMES_DIR, IManifestGame, hasManifest, readManifest } from './replay/gameManifest';
import { saveAudit, saveAuditError, writeReport } from './replay/gameReport';
import { ENGINE_DIR, NodeWorkerEngine, hasEngineBuild } from './replay/nodeEngine';
import { realReplayCards } from './replay/realReplays';

/**
 * "Pick up from here" on REAL double-sided games with their REAL decklists, driven by the private fixtures
 * manifest (REPLAY_GAMES_DIR, see replay/gameManifest.ts; nothing real is in this repo). One test per game: every
 * game whose two exports and two decklists are present is imported both ways round (the panel's swap), every
 * pick-up-able moment is rebuilt and checked, loaded into the engine's Worker build (in a Node thread, no browser)
 * and played on to a draw (replay/gameAudit.ts). Games with an export missing are skipped, saying which file.
 * Each run rewrites REPORT.md in the fixtures folder (P1/P2 and leader names only).
 *
 *   cd e2e/sandbox && npx playwright test replay-games          (needs public/sandbox: scripts/sandbox/sync-engine-assets.mjs)
 */
const games: IManifestGame[] = hasManifest() ? readManifest() : [];

const meta = () => {
    const git = (cmd: string) => {
        try {
            return execSync(cmd, { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
        } catch {
            return '?';
        }
    };
    const worker = path.join(ENGINE_DIR, 'sandbox.worker.js');
    const built = fs.existsSync(worker) ? fs.statSync(worker).mtime.toISOString().slice(0, 16).replace('T', ' ') : 'missing';
    return { client: `forceteki-client ${git('git rev-parse --abbrev-ref HEAD')} @ ${git('git rev-parse --short HEAD')}`, engine: `public/sandbox/engine/sandbox.worker.js built ${built} UTC` };
};

test.describe('real double-sided games (manifest)', () => {
    test.describe.configure({ retries: 0 });
    let engine: NodeWorkerEngine | null = null;

    test.beforeAll(async () => {
        if (games.some((g) => g.ready) && hasEngineBuild()) {
            engine = await NodeWorkerEngine.start();
        }
    });
    test.afterAll(async () => {
        await engine?.close();
    });

    if (!games.length) {
        test('manifest', () => {
            test.skip(true, `no replay fixtures manifest at ${GAMES_DIR} (REPLAY_GAMES_DIR)`);
        });
    }

    for (const g of games) {
        const leaders = g.seats.map((s) => s.entry.leader ?? '?').join(' vs ');
        const match = g.gamesInMatch > 1 ? `, game ${g.gameInMatch} of ${g.gamesInMatch}` : '';
        test(`${g.tag} (${leaders}${match})`, async () => {
            test.skip(!g.ready, g.missing.join('; '));
            test.skip(!hasEngineBuild(), 'no engine worker build in public/sandbox/engine (run scripts/sandbox/sync-engine-assets.mjs)');
            test.setTimeout(20 * 60_000);
            const cards = realReplayCards();
            let audits: IGameAudit[] = [];
            try {
                audits = [
                    await auditGame(g, { engine, cards }),
                    await auditGame(g, { engine, cards, swapped: true }),
                ];
                saveAuditError(GAMES_DIR, g.gameId, null);
            } catch (e) {
                // keep the message handle-free: it names files and stages, never gamestate content
                saveAuditError(GAMES_DIR, g.gameId, String((e as Error).message ?? e).split('\n')[0].slice(0, 300));
                throw e;
            } finally {
                if (audits[0]) {
                    saveAudit(GAMES_DIR, audits[0]);
                }
                if (audits[1]) {
                    saveAudit(GAMES_DIR, audits[1], '.swapped');
                }
                writeReport(games, GAMES_DIR, meta(), games.filter((x) => x.ready).flatMap(handlePatterns));
            }
            const [a, swapped] = audits;
            console.log(`${g.tag} ${a.title}: ${a.alignment.matchedRuns}/${Math.max(a.alignment.runsA, a.alignment.runsB)} runs aligned, `
                + `${a.clean}/${a.moments} pick-up-able, ${a.findings.filter((f) => f.severity === 'fail').length} failure(s), ${(a.durationMs / 1000).toFixed(1)} s`);
            expect(a.clean, 'pick-up-able moments').toBeGreaterThan(0);
            const failures = (x: IGameAudit, how: string) => x.findings.filter((f) => f.severity === 'fail').map((f) => `${how} ${f.category}: ${f.message}${f.moments ? ` [${f.moments.slice(0, 3).join('; ')}${f.moments.length > 3 ? '; …' : ''}]` : ''}`);
            expect([...failures(a, 'P1 first:'), ...failures(swapped, 'swapped:')]).toEqual([]);
        });
    }
});
