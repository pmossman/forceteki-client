/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SandboxEngine over socket.io (CONTRACT.md §3): namespace `/sandbox`, path `/ws`, one event per
 * method with an acknowledgement. A session lives as long as the connection; after a reconnect the
 * caller restores it with `load({ tree })` (useSandboxSession does this automatically).
 */
import io, { Socket } from 'socket.io-client';
import {
    EngineStatus, IActResult, IEnginePosition, IExportResult, IGotoResult, ILoadRequest, ILoadResult, IParseResult,
    ISandboxInput, ISandboxSnapshot, ISerializedTree, IValidateResult, SandboxEngine,
} from './SandboxEngine';

const CALL_TIMEOUT_MS = 30000;

export const sandboxServerUrl = (): string => process.env.NEXT_PUBLIC_ROOT_URL || 'http://localhost:9600';

export class SocketSandboxEngine implements SandboxEngine {
    public readonly kind = 'socket' as const;
    private socket: Socket | null = null;
    private snapshotListeners = new Set<(s: ISandboxSnapshot) => void>();
    private statusListeners = new Set<(s: EngineStatus, detail?: string) => void>();
    private status: EngineStatus = 'connecting';

    public constructor(private readonly url: string = sandboxServerUrl()) {}

    public connect(): void {
        if (this.socket) {
            return;
        }
        const socket = io(`${this.url}/sandbox`, { path: '/ws', transports: ['websocket'], reconnectionDelayMax: 3000 });
        this.socket = socket;
        this.setStatus('connecting');
        socket.on('connect', () => this.setStatus('ready'));
        socket.on('disconnect', (reason) => this.setStatus('disconnected', String(reason)));
        socket.on('connect_error', (err) => this.setStatus('error', err?.message ?? String(err)));
        socket.on('snapshot', (snapshot: ISandboxSnapshot) => {
            this.snapshotListeners.forEach((l) => l(snapshot));
        });
    }

    public dispose(): void {
        this.socket?.removeAllListeners();
        this.socket?.disconnect();
        this.socket = null;
        this.snapshotListeners.clear();
        this.statusListeners.clear();
    }

    public getStatus() {
        return this.status;
    }

    private setStatus(status: EngineStatus, detail?: string) {
        this.status = status;
        this.statusListeners.forEach((l) => l(status, detail));
    }

    private call<T>(event: string, payload: unknown): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            if (!this.socket) {
                reject(new Error('sandbox engine not connected'));
                return;
            }
            this.socket.timeout(CALL_TIMEOUT_MS).emit(event, payload, (err: unknown, result: T) => {
                if (err) {
                    reject(new Error(`sandbox server did not answer "${event}" (${this.status})`));
                } else {
                    resolve(result);
                }
            });
        });
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
