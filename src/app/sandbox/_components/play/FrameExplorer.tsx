'use client';
import React, { useEffect, useRef } from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import VerticalAlignTopIcon from '@mui/icons-material/VerticalAlignTop';
import FirstPageIcon from '@mui/icons-material/FirstPage';
import LastPageIcon from '@mui/icons-material/LastPage';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { ISandboxTree, ISandboxTreeNode, Seat } from '../../_engine/SandboxEngine';
import { SEAT_COLOR, panelSx, sectionTitleSx } from '../sandboxTheme';

interface IFrameExplorerProps {
    tree: ISandboxTree;
    currentId: string;
    pendingId: string | null;
    onGoto: (id: string) => void;
    onDelete: (id: string) => void;
    onPromote: (id: string) => void;

    /** the current frame's game log; with node.logIndex it gives each decision's effects on the current line */
    log?: string[];
}

const pathTo = (tree: ISandboxTree, id: string): Set<string> => {
    const out = new Set<string>();
    let cur: ISandboxTreeNode | undefined = tree.nodes[id];
    while (cur) {
        out.add(cur.id);
        cur = cur.parentId ? tree.nodes[cur.parentId] : undefined;
    }
    return out;
};

/** Last node of the line that continues from `id` along children[0]. */
const lineEnd = (tree: ISandboxTree, id: string) => {
    let cur = tree.nodes[id];
    while (cur && cur.children.length > 0) {
        cur = tree.nodes[cur.children[0]];
    }
    return cur?.id ?? id;
};

/**
 * The move list / analysis tree (DESIGN §5, Lichess-style). Each row is one decision; click to jump
 * there. Alternatives at a fork are shown as indented variations right after the main-line move.
 * Keys: ←/→ step, ↑/↓ switch between alternatives at a fork, Home/End.
 */
const FrameExplorer: React.FC<IFrameExplorerProps> = ({ tree, currentId, pendingId, onGoto, onDelete, onPromote, log }) => {
    const shownId = pendingId ?? currentId;
    const onPath = pathTo(tree, shownId);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = scrollRef.current?.querySelector('[data-current="true"]') as HTMLElement | null;
        el?.scrollIntoView({ block: 'nearest' });
    }, [shownId]);

    const step = {
        back: () => {
            const n = tree.nodes[shownId];
            if (n?.parentId) {
                onGoto(n.parentId);
            }
        },
        forward: () => {
            const n = tree.nodes[shownId];
            if (n?.children.length) {
                onGoto(n.children[0]);
            }
        },
        sibling: (delta: number) => {
            const n = tree.nodes[shownId];
            const parent = n?.parentId ? tree.nodes[n.parentId] : null;
            if (!parent || parent.children.length < 2) {
                return;
            }
            const i = parent.children.indexOf(n.id);
            onGoto(parent.children[(i + delta + parent.children.length) % parent.children.length]);
        },
        home: () => onGoto(tree.rootId),
        end: () => onGoto(lineEnd(tree, shownId)),
    };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const el = e.target as HTMLElement;
            if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
                return;
            }
            const map: Record<string, () => void> = {
                ArrowLeft: step.back, ArrowRight: step.forward, ArrowUp: () => step.sibling(-1), ArrowDown: () => step.sibling(1), Home: step.home, End: step.end,
            };
            if (map[e.key]) {
                e.preventDefault();
                map[e.key]();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });

    const row = (node: ISandboxTreeNode, indent: number, isVariationStart: boolean) => {
        const current = node.id === shownId;
        const parent = node.parentId ? tree.nodes[node.parentId] : null;
        const forkSize = parent && parent.children.length > 1 ? parent.children.length : 0;
        const isMain = !parent || parent.children[0] === node.id;
        const seatColor = node.seat ? SEAT_COLOR[node.seat as Seat] : '#fff';
        // what this decision did, for decisions on the line that is on the board now
        const effects = log && onPath.has(node.id) && parent && typeof node.logIndex === 'number' && typeof parent.logIndex === 'number'
            ? log.slice(parent.logIndex, node.logIndex).filter((l) => l.trim().length > 0)
            : [];
        return (
            <Box
                key={node.id}
                data-current={current}
                data-testid={`tree-node-${node.id}`}
                data-node-label={node.label}
                onClick={() => onGoto(node.id)}
                sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: '0 6px',
                    pl: `${6 + indent * 14}px`,
                    pr: '4px',
                    py: '2px',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    background: current ? 'rgba(102,229,255,0.28)' : onPath.has(node.id) ? 'rgba(255,255,255,0.06)' : 'transparent',
                    outline: current && pendingId ? '1px dashed var(--selection-yellow)' : 'none',
                    '&:hover': { background: current ? 'rgba(102,229,255,0.34)' : 'rgba(255,255,255,0.10)' },
                    '&:hover .tree-actions': { opacity: 1 },
                    borderLeft: indent > 0 ? '2px solid rgba(201,168,255,0.35)' : '2px solid transparent',
                }}
            >
                {node.kind === 'action' ? (
                    <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, m: 0, minWidth: '1.4rem', color: 'rgba(255,255,255,0.6)' }}>{node.actionNumber}.</Typography>
                ) : (
                    <Box sx={{ minWidth: '1.4rem' }} />
                )}
                <Box sx={{ width: 7, height: 7, borderRadius: '50%', background: seatColor, flex: '0 0 auto', opacity: node.seat ? 1 : 0 }} />
                <Typography
                    sx={{
                        fontSize: node.kind === 'action' ? '0.82rem' : '0.76rem',
                        fontWeight: node.kind === 'action' ? 700 : 500,
                        fontStyle: isMain ? 'normal' : 'italic',
                        m: 0,
                        flex: 1,
                        minWidth: 0,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        color: isVariationStart ? '#d9c6ff' : '#fff',
                    }}
                    title={node.promptTitle ? `${node.label}  (answering: ${node.promptTitle})` : node.label}
                >
                    {node.label}
                </Typography>
                {forkSize > 0 && (
                    <Tooltip title={`Fork: ${forkSize} alternatives here (↑/↓ to switch)`}>
                        <Typography sx={{ fontSize: '0.7rem', m: 0, color: '#c9a8ff', fontWeight: 800 }} data-testid="tree-fork-marker">◆{forkSize}</Typography>
                    </Tooltip>
                )}
                <Box className="tree-actions" sx={{ display: 'flex', opacity: 0, transition: 'opacity 0.15s' }} onClick={(e) => e.stopPropagation()}>
                    {!isMain && (
                        <Tooltip title="Make this the main line">
                            <IconButton size="small" sx={{ p: '1px', color: '#c9a8ff' }} onClick={() => onPromote(node.id)}><VerticalAlignTopIcon sx={{ fontSize: '0.9rem' }} /></IconButton>
                        </Tooltip>
                    )}
                    <Tooltip title="Delete from here">
                        <IconButton size="small" sx={{ p: '1px', color: '#ff8a8a' }} onClick={() => onDelete(node.id)}><DeleteOutlineIcon sx={{ fontSize: '0.9rem' }} /></IconButton>
                    </Tooltip>
                </Box>
                {effects.length > 0 && (
                    <Box sx={{ flexBasis: '100%', pl: '1.9rem', pb: '1px' }} title={effects.join('\n')} data-testid="tree-effects">
                        {effects.slice(0, 2).map((line, i) => (
                            <Typography key={i} sx={{ fontSize: '0.66rem', m: 0, color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 }}>
                                {line}
                            </Typography>
                        ))}
                        {effects.length > 2 && <Typography sx={{ fontSize: '0.62rem', m: 0, color: 'rgba(255,255,255,0.35)' }}>+{effects.length - 2} more</Typography>}
                    </Box>
                )}
            </Box>
        );
    };

    /** Render a line starting at `id` (inclusive), Lichess-style: the alternatives at a fork follow the main-line move. */
    const renderLine = (id: string, indent: number, out: React.ReactNode[], variationStart = false) => {
        let node: ISandboxTreeNode | undefined = tree.nodes[id];
        if (!node) {
            return;
        }
        out.push(row(node, indent, variationStart));
        while (node && node.children.length > 0) {
            const [mainId, ...alts]: string[] = node.children;
            const main: ISandboxTreeNode | undefined = tree.nodes[mainId];
            if (!main) {
                break;
            }
            out.push(row(main, indent, false));
            for (const alt of alts) {
                const block: React.ReactNode[] = [];
                renderLine(alt, indent + 1, block, true);
                out.push(<Box key={`var-${alt}`} sx={{ my: '1px' }} data-testid="tree-variation">{block}</Box>);
            }
            node = main;
        }
    };

    const rows: React.ReactNode[] = [];
    renderLine(tree.rootId, 0, rows);
    const nodeCount = Object.keys(tree.nodes).length - 1;

    return (
        <Box sx={{ ...panelSx, p: '10px', display: 'flex', flexDirection: 'column', gap: '6px', minHeight: 0, flex: 1 }} data-testid="frame-explorer">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Typography sx={sectionTitleSx}>Moves &amp; variations</Typography>
                <Typography sx={{ ...sectionTitleSx, color: 'rgba(255,255,255,0.35)' }}>{nodeCount}</Typography>
                <Box sx={{ flex: 1 }} />
                <Tooltip title="Start (Home)"><IconButton size="small" sx={{ color: '#fff', p: '2px' }} onClick={step.home} aria-label="Go to start"><FirstPageIcon fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="Back (←)"><IconButton size="small" sx={{ color: '#fff', p: '2px' }} onClick={step.back} aria-label="Step back" data-testid="tree-back"><ChevronLeftIcon fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="Forward (→)"><IconButton size="small" sx={{ color: '#fff', p: '2px' }} onClick={step.forward} aria-label="Step forward"><ChevronRightIcon fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="End of line (End)"><IconButton size="small" sx={{ color: '#fff', p: '2px' }} onClick={step.end} aria-label="Go to end"><LastPageIcon fontSize="small" /></IconButton></Tooltip>
            </Box>
            <Box ref={scrollRef} sx={{ overflowY: 'auto', minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
                {rows}
            </Box>
            <Typography sx={{ fontSize: '0.62rem', m: 0, color: 'rgba(255,255,255,0.35)' }}>
                Click any decision to jump back to it, then choose differently to branch. ←/→ step · ↑/↓ alternatives.
            </Typography>
        </Box>
    );
};

export default FrameExplorer;
