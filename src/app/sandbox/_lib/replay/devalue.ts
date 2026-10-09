/**
 * Reading a SvelteKit `__data.json` (what a browser saves from a SWU Forge replay page).
 *
 * SvelteKit serialises each route node's data with `devalue`: a flat array where index 0 is the root and every
 * other value refers to its children by index. This is a small, dependency-free port of devalue's `unflatten`
 * (MIT, Rich Harris), limited to what JSON-transported page data can contain.
 */

const UNDEFINED = -1;
const HOLE = -2;
const NAN = -3;
const POSITIVE_INFINITY = -4;
const NEGATIVE_INFINITY = -5;
const NEGATIVE_ZERO = -6;

export class DevalueError extends Error {}

/** devalue `unflatten`: the flat array (or a bare number) back into a value. */
export const unflatten = (parsed: unknown): unknown => {
    if (typeof parsed === 'number') {
        return special(parsed);
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new DevalueError('Not a devalue payload (expected a non-empty array)');
    }
    const values = parsed as unknown[];
    const hydrated: unknown[] = new Array(values.length);
    const done: boolean[] = new Array(values.length).fill(false);

    const hydrate = (index: number): unknown => {
        if (index < 0) {
            return special(index);
        }
        if (index >= values.length) {
            throw new DevalueError(`devalue index ${index} out of range`);
        }
        if (done[index]) {
            return hydrated[index];
        }
        const value = values[index];
        if (value === null || typeof value !== 'object') {
            hydrated[index] = value;
            done[index] = true;
            return value;
        }
        if (Array.isArray(value)) {
            if (typeof value[0] === 'string') {
                return hydrateTyped(index, value);
            }
            const array: unknown[] = new Array(value.length);
            hydrated[index] = array;
            done[index] = true;
            for (let i = 0; i < value.length; i++) {
                const n = value[i] as number;
                if (n === HOLE) {
                    continue;
                }
                array[i] = hydrate(n);
            }
            return array;
        }
        const object: Record<string, unknown> = {};
        hydrated[index] = object;
        done[index] = true;
        for (const key of Object.keys(value)) {
            object[key] = hydrate((value as Record<string, number>)[key]);
        }
        return object;
    };

    const hydrateTyped = (index: number, value: unknown[]): unknown => {
        const type = value[0] as string;
        switch (type) {
            case 'Date':
                hydrated[index] = new Date(value[1] as string);
                break;
            case 'Set': {
                const set = new Set<unknown>();
                hydrated[index] = set;
                done[index] = true;
                for (let i = 1; i < value.length; i++) {
                    set.add(hydrate(value[i] as number));
                }
                return set;
            }
            case 'Map': {
                const map = new Map<unknown, unknown>();
                hydrated[index] = map;
                done[index] = true;
                for (let i = 1; i < value.length; i += 2) {
                    map.set(hydrate(value[i] as number), hydrate(value[i + 1] as number));
                }
                return map;
            }
            case 'RegExp':
                hydrated[index] = new RegExp(value[1] as string, value[2] as string | undefined);
                break;
            case 'Object':
                hydrated[index] = Object(value[1]);
                break;
            case 'BigInt':
                hydrated[index] = BigInt(value[1] as string);
                break;
            case 'null': {
                const obj = Object.create(null) as Record<string, unknown>;
                hydrated[index] = obj;
                done[index] = true;
                for (let i = 1; i < value.length; i += 2) {
                    obj[value[i] as string] = hydrate(value[i + 1] as number);
                }
                return obj;
            }
            default:
                throw new DevalueError(`Unsupported devalue type "${type}"`);
        }
        done[index] = true;
        return hydrated[index];
    };

    return hydrate(0);
};

const special = (n: number): unknown => {
    switch (n) {
        case UNDEFINED:
            return undefined;
        case NAN:
            return NaN;
        case POSITIVE_INFINITY:
            return Infinity;
        case NEGATIVE_INFINITY:
            return -Infinity;
        case NEGATIVE_ZERO:
            return -0;
        default:
            throw new DevalueError(`Unexpected devalue constant ${n}`);
    }
};

/**
 * The data of every route node in a SvelteKit `__data.json` (`{ type: 'data', nodes: [...] }`), outermost
 * layout first. Skipped / errored nodes come back as `null`.
 */
export const readSvelteKitData = (json: unknown): (Record<string, unknown> | null)[] => {
    const doc = json as { type?: unknown; nodes?: unknown };
    if (!doc || typeof doc !== 'object' || doc.type !== 'data' || !Array.isArray(doc.nodes)) {
        throw new DevalueError('Not a SvelteKit __data.json (expected { type: "data", nodes: [...] })');
    }
    return doc.nodes.map((node) => {
        const n = node as { type?: unknown; data?: unknown };
        if (!n || n.type !== 'data' || n.data == null) {
            return null;
        }
        const value = unflatten(n.data);
        return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
    });
};
