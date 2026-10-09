/**
 * The sandbox engine's Web Worker build, run in Node for tests: the exact `public/sandbox/engine/sandbox.worker.js`
 * that /sandbox serves (copied there by scripts/sandbox/sync-engine-assets.mjs), started in a `worker_threads`
 * thread with `self` mapped onto the thread's port. Same envelope as the browser (CONTRACT.md §3b):
 *   test -> worker  { id, method, payload }   (first call: loadCards { blob })
 *   worker -> test  { id, ok, result | error }, plus { event: 'snapshot' | 'booted' }
 * No browser and no server, so hundreds of positions load in seconds.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

export const ENGINE_DIR = path.join(__dirname, '../../../public/sandbox/engine');
export const hasEngineBuild = () => ['sandbox.worker.js', 'cards.json'].every((f) => fs.existsSync(path.join(ENGINE_DIR, f)));

const BOOT = `
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');
globalThis.self = globalThis;
globalThis.postMessage = (m) => parentPort.postMessage(m);
parentPort.on('message', (data) => globalThis.onmessage && globalThis.onmessage({ data }));
vm.runInThisContext(require('node:fs').readFileSync(workerData.script, 'utf8'), { filename: workerData.script });
`;

const CALL_TIMEOUT_MS = 60_000;

export class NodeWorkerEngine {
    private nextId = 1;
    private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

    private constructor(private readonly worker: Worker) {
        worker.on('message', (msg: { id?: number; ok?: boolean; result?: unknown; error?: string; event?: string }) => {
            if (msg?.event) {
                return;
            }
            const p = this.pending.get(msg.id!);
            if (!p) {
                return;
            }
            this.pending.delete(msg.id!);
            clearTimeout(p.timer);
            if (msg.ok) {
                p.resolve(msg.result);
            } else {
                p.reject(new Error(String(msg.error ?? 'engine worker error')));
            }
        });
        worker.on('error', (e) => {
            for (const p of this.pending.values()) {
                clearTimeout(p.timer);
                p.reject(e);
            }
            this.pending.clear();
        });
    }

    /** Boots the worker build and loads the card blob. */
    public static async start(dir = ENGINE_DIR): Promise<NodeWorkerEngine> {
        const engine = new NodeWorkerEngine(new Worker(BOOT, { eval: true, workerData: { script: path.join(dir, 'sandbox.worker.js') } }));
        await engine.call('loadCards', { blob: JSON.parse(fs.readFileSync(path.join(dir, 'cards.json'), 'utf8')) });
        return engine;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public call<T = any>(method: string, payload: unknown): Promise<T> {
        const id = this.nextId++;
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`engine call ${method} timed out after ${CALL_TIMEOUT_MS} ms`));
            }, CALL_TIMEOUT_MS);
            this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
            this.worker.postMessage({ id, method, payload });
        });
    }

    public async close(): Promise<void> {
        await this.worker.terminate();
    }
}
