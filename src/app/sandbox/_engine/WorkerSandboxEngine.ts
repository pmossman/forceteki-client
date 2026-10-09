/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SandboxEngine running entirely in the browser: the forceteki sandbox module bundled as a Web Worker
 * (CONTRACT.md §3b). Same methods, payloads and results as the socket; only the envelope differs:
 *   page -> worker  { id, method, payload }          (the first call is loadCards { url })
 *   worker -> page  { id, ok, result | error }, plus { event: 'snapshot', data } and { event: 'booted' }
 * One worker is one session. No server involved: this is what makes /sandbox a static site.
 *
 * Assets are served from public/sandbox/engine/ (copied by scripts/sandbox/sync-engine-assets.mjs).
 */
import {
    EngineStatus, IActResult, IEnginePosition, IExportResult, IGotoResult, ILoadRequest, ILoadResult, IParseResult,
    ISandboxInput, ISandboxSnapshot, ISerializedTree, IValidateResult, SandboxEngine,
} from './SandboxEngine';

const WORKER_URL = '/sandbox/engine/sandbox.worker.js';
const CARDS_URL = '/sandbox/engine/cards.json';
const CALL_TIMEOUT_MS = 30000;

export class WorkerSandboxEngine implements SandboxEngine {
    public readonly kind = 'worker' as const;
    private worker: Worker | null = null;
    private nextId = 1;
    private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: number }>();
    private snapshotListeners = new Set<(s: ISandboxSnapshot) => void>();
    private statusListeners = new Set<(s: EngineStatus, detail?: string) => void>();
    private status: EngineStatus = 'connecting';
    private ready: Promise<void> | null = null;

    public connect(): void {
        if (this.worker) {
            return;
        }
        this.setStatus('connecting', 'starting the in-browser engine');
        let worker: Worker;
        try {
            worker = new Worker(WORKER_URL);
        } catch (e) {
            this.setStatus('error', `could not start the engine worker: ${(e as Error).message}`);
            return;
        }
        this.worker = worker;
        let resolveBooted: () => void = () => undefined;
        const booted = new Promise<void>((resolve) => {
            resolveBooted = resolve;
        });
        worker.onmessage = (event: MessageEvent) => {
            const msg = event.data;
            if (msg?.event === 'booted') {
                resolveBooted();
                return;
            }
            if (msg?.event === 'snapshot') {
                this.snapshotListeners.forEach((l) => l(msg.data as ISandboxSnapshot));
                return;
            }
            const p = this.pending.get(msg?.id);
            if (!p) {
                return;
            }
            this.pending.delete(msg.id);
            window.clearTimeout(p.timer);
            if (msg.ok) {
                p.resolve(msg.result);
            } else {
                p.reject(new Error(String(msg.error ?? 'engine worker error')));
            }
        };
        worker.onerror = (event: ErrorEvent) => {
            this.setStatus('error', `engine worker failed: ${event.message || 'see the console'}`);
        };
        this.ready = booted
            .then(() => this.post<{ cards: number; ms: number }>('loadCards', { url: CARDS_URL }))
            .then(() => this.setStatus('ready', 'in-browser engine'))
            .catch((e) => {
                this.setStatus('error', `engine worker could not load cards: ${e.message}`);
                throw e;
            });
        this.ready.catch(() => undefined);
    }

    public dispose(): void {
        this.worker?.terminate();
        this.worker = null;
        for (const p of this.pending.values()) {
            window.clearTimeout(p.timer);
            p.reject(new Error('engine disposed'));
        }
        this.pending.clear();
        this.snapshotListeners.clear();
        this.statusListeners.clear();
    }

    private setStatus(status: EngineStatus, detail?: string) {
        this.status = status;
        this.statusListeners.forEach((l) => l(status, detail));
    }

    private post<T>(method: string, payload: unknown): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            if (!this.worker) {
                reject(new Error('engine worker not started'));
                return;
            }
            const id = this.nextId++;
            const timer = window.setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`the engine did not answer "${method}"`));
            }, CALL_TIMEOUT_MS);
            this.pending.set(id, { resolve, reject, timer });
            this.worker.postMessage({ id, method, payload });
        });
    }

    /** Session calls wait for the worker to boot and load its cards. */
    private async call<T>(method: string, payload: unknown): Promise<T> {
        if (!this.ready) {
            throw new Error('engine worker not started');
        }
        await this.ready;
        return this.post<T>(method, payload);
    }

    public parsePosition(text: string) {
        return this.call<IParseResult>('parsePosition', { text });
    }

    public async formatPosition(position: IEnginePosition) {
        const res = await this.call<{ text: string }>('formatPosition', { position });
        return res.text;
    }

    public validatePosition(input: { text?: string; position?: IEnginePosition }) {
        return this.call<IValidateResult>('validatePosition', input);
    }

    public load(req: ILoadRequest) {
        return this.call<ILoadResult>('load', req);
    }

    public act(input: ISandboxInput) {
        return this.call<IActResult>('act', input);
    }

    public goto(nodeId: string) {
        return this.call<IGotoResult>('goto', { nodeId });
    }

    public deleteNode(nodeId: string) {
        return this.call<IGotoResult>('deleteNode', { nodeId });
    }

    public promoteNode(nodeId: string) {
        return this.call<IGotoResult>('promoteNode', { nodeId });
    }

    public exportPosition() {
        return this.call<IExportResult>('exportPosition', {});
    }

    public serializeTree() {
        return this.call<ISerializedTree>('serializeTree', {});
    }

    public onSnapshot(listener: (s: ISandboxSnapshot) => void) {
        this.snapshotListeners.add(listener);
        return () => {
            this.snapshotListeners.delete(listener);
        };
    }

    public onStatus(listener: (s: EngineStatus, detail?: string) => void) {
        this.statusListeners.add(listener);
        listener(this.status);
        return () => {
            this.statusListeners.delete(listener);
        };
    }
}
