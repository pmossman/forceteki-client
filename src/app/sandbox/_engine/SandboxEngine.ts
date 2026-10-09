/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The one boundary between the sandbox UI and the rules engine (CONTRACT.md v1).
 *
 * The sandbox UI never talks to sockets, lobbies or users directly: everything goes through a
 * `SandboxEngine`. Tonight the implementation is a socket adapter onto the forceteki dev server
 * (SocketSandboxEngine). The north star is a static site with the engine in a Web Worker; a worker
 * adapter implements this same interface and the UI does not change.
 *
 * Every state-changing call resolves with the new snapshot and the adapter also emits it through
 * `onSnapshot`; the UI renders from `onSnapshot` only, so there is one code path for every adapter.
 */

export type Seat = 'p1' | 'p2';
export const SEATS: Seat[] = ['p1', 'p2'];
export const otherSeat = (seat: Seat): Seat => (seat === 'p1' ? 'p2' : 'p1');
export const seatLabel = (seat: Seat): string => (seat === 'p1' ? 'P1' : 'P2');

export interface IIssue { path: string; message: string; line?: number }

// ---------------- Position object (POSITION-FORMAT.md §2) ----------------

export interface ICardEntry { card: string }
export interface IResourceEntry extends ICardEntry { exhausted?: boolean }
export interface IUpgradeEntry extends ICardEntry { owner?: Seat }
export interface ICapturedEntry extends ICardEntry { owner?: Seat }
export interface IUnitEntry extends ICardEntry {
    damage?: number; exhausted?: boolean; owner?: Seat;
    upgrades?: IUpgradeEntry[]; captured?: ICapturedEntry[];
}
export interface ILeaderEntry extends ICardEntry {
    deployed?: boolean; exhausted?: boolean; damage?: number; epicActionUsed?: boolean; flipped?: boolean;
    upgrades?: IUpgradeEntry[]; captured?: ICapturedEntry[];
}
export interface IBaseEntry extends ICardEntry { damage?: number; upgrades?: IUpgradeEntry[]; captured?: ICapturedEntry[] }
export interface IPlayerPosition {
    leader?: ILeaderEntry;
    base?: IBaseEntry;
    ground: IUnitEntry[];
    space: IUnitEntry[];
    resources: IResourceEntry[];
    hand: ICardEntry[];
    deck: ICardEntry[];
    discard: ICardEntry[];
    credits?: number;
    force?: boolean;
}
export interface IEnginePosition {
    version: 1;
    title?: string;
    phase: 'action' | 'regroup';
    initiative: Seat;
    active?: Seat;
    p1: IPlayerPosition;
    p2: IPlayerPosition;
}

// ---------------- Inputs and results ----------------

export interface ISandboxInput {
    seat?: Seat;
    command: 'cardClicked' | 'menuButton' | 'perCardMenuButton' | 'statefulPromptResults' | string;
    args: any[];
}

export type ILoadResult =
    | { ok: true; snapshot: ISandboxSnapshot; warnings: IIssue[] }
    | { ok: false; errors: IIssue[]; warnings: IIssue[] };

export type IActResult =
    | { ok: true; snapshot: ISandboxSnapshot; nodeId: string; reusedExistingNode: boolean }
    | { ok: false; error: string; snapshot?: ISandboxSnapshot };

export type IGotoResult = { ok: true; snapshot: ISandboxSnapshot } | { ok: false; error: string; snapshot?: ISandboxSnapshot };

export interface IExportResult { text: string; position: IEnginePosition; warnings: IIssue[] }
export interface IParseResult { position?: IEnginePosition; errors: IIssue[]; warnings: IIssue[] }
export interface IValidateResult {
    ok: boolean;
    position?: IEnginePosition;
    canonicalText?: string;
    errors: IIssue[];
    warnings: IIssue[];
}

export interface ILoadRequest {
    position?: string | IEnginePosition;
    seed?: string;
    tree?: ISerializedTree;
}

// ---------------- Snapshot ----------------

export interface IPromptInfo {
    seat: Seat;
    deciding: boolean;
    menuTitle: string;
    promptTitle: string;
    promptType: string;
    buttons: { text: string; arg: string; command: string }[];
    selectableCardUuids: string[];
}

export interface ICardRef { uuid: string; name: string; internalName: string; setId?: { set: string; number?: number }; controller?: Seat }

export interface IStackItem {
    id: string;
    title: string;
    label: string;
    engineTitle: string;
    sourceCard: ICardRef;
    controller: Seat;
    status: 'resolving' | 'pending' | 'resolved';
    optional: boolean;
    hasLegalEffects: boolean;
    count?: number;
    fromHiddenZone?: boolean;
}

export interface IStackFrame {
    id: string;
    kind: 'action' | 'ability' | 'triggerLayer' | string;
    depth: number;
    title: string;
    controller?: Seat;
    sourceCard?: ICardRef;
    status: 'resolving' | 'waiting' | 'collecting' | string;
    waitingReason?: string;
    triggeredBy?: string[];
    nestedUnder?: { frameId: string; itemId?: string; title: string };
    chooser?: { seat: Seat; choosing: 'playerOrder' | 'abilityOrder' | string; text: string } | null;
    items?: IStackItem[];
    rulesHint?: { text: string; refs: string[] };
    engine?: { step: string; detail: string };
}

export interface ISandboxTreeNode {
    id: string;
    parentId: string | null;
    children: string[];
    kind: 'root' | 'action' | 'decision';
    seat?: Seat;
    input?: ISandboxInput;
    label: string;
    promptTitle?: string;
    actionNumber: number;
    ply: number;
}

export interface ISandboxTree {
    rootId: 'root' | string;
    nodes: Record<string, ISandboxTreeNode>;
    mainLine: string[];
}

export interface ISerializedTree {
    format: 'karabast-sandbox-tree';
    version: 1;
    root: { positionText: string; seed: string };
    nodes: { id: string; parentId: string | null; input: ISandboxInput | null; label: string; kind: string; promptTitle?: string }[];
    currentNodeId: string;
}

export interface ISandboxSnapshot {
    nodeId: string;
    tree: ISandboxTree;
    views: { p1: any; p2: any };
    godView: any;
    deciders: Seat[];
    prompts: { p1: IPromptInfo; p2: IPromptInfo };

    /** top first: frames[0] is "now" */
    stack: IStackFrame[];
    log: string[];
    gameOver?: { winners: string[] };
    engineErrors?: string[];
}

export type EngineStatus = 'connecting' | 'ready' | 'disconnected' | 'error';

export interface SandboxEngine {
    readonly kind: 'socket' | 'worker' | 'mock';

    connect(): void;
    dispose(): void;

    // positions (stateless)
    parsePosition(text: string): Promise<IParseResult>;
    formatPosition(position: IEnginePosition): Promise<string>;
    validatePosition(input: { text?: string; position?: IEnginePosition }): Promise<IValidateResult>;

    // session
    load(req: ILoadRequest): Promise<ILoadResult>;
    act(input: ISandboxInput): Promise<IActResult>;
    goto(nodeId: string): Promise<IGotoResult>;
    deleteNode(nodeId: string): Promise<IGotoResult>;
    promoteNode(nodeId: string): Promise<IGotoResult>;
    exportPosition(): Promise<IExportResult>;
    serializeTree(): Promise<ISerializedTree>;

    onSnapshot(listener: (snapshot: ISandboxSnapshot) => void): () => void;
    onStatus(listener: (status: EngineStatus, detail?: string) => void): () => void;
}
