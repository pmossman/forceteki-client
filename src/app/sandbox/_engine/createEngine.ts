import { SandboxEngine } from './SandboxEngine';
import { SocketSandboxEngine } from './SocketSandboxEngine';
import { WorkerSandboxEngine } from './WorkerSandboxEngine';

export type EngineKind = 'worker' | 'socket';

/** The in-browser worker unless the page asks for the dev server with `?engine=socket`. */
export const DEFAULT_ENGINE: EngineKind = 'worker';

export const requestedEngineKind = (): EngineKind => {
    const param = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('engine');
    return param === 'socket' || param === 'worker' ? param : DEFAULT_ENGINE;
};

export const createSandboxEngine = (kind: EngineKind = requestedEngineKind()): SandboxEngine =>
    (kind === 'socket' ? new SocketSandboxEngine() : new WorkerSandboxEngine());
