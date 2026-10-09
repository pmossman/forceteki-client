'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, Button, IconButton, Popover, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import CloseIcon from '@mui/icons-material/Close';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ShieldIcon from '@/assets/token-icons/shield.svg';
import ExperienceIcon from '@/assets/token-icons/experience.svg';
import { useGameOptional } from '@/app/_contexts/Game.context';
import { Seat, seatLabel } from '../../_engine/SandboxEngine';
import { CardIndex, CardKind, ISandboxCard, displayName } from '../../_lib/cardIndex';
import { EditorZone, IPosCard, PileZone } from '../../_lib/position';
import { EditorApi, ITarget, findCard } from '../../_lib/useEditor';
import { EditRef, locateInView, mapViewCardToEditor } from '../../_lib/viewMapping';
import { patchAdd, patchAddToken, patchDamage, patchExhaust, patchRemove, patchSwap } from '../../_lib/optimistic';
import CardSearch from '../editor/CardSearch';
import Inspector from '../editor/Inspector';
import SwapPicker from './SwapPicker';
import { IOptimistic } from '../SandboxStage';
import { SEAT_COLOR, panelSx, pillButtonSx, sectionTitleSx } from '../sandboxTheme';

interface IEditOverlayProps {

    /** the board container: zones and cards inside it get edit affordances */
    containerRef: React.RefObject<HTMLDivElement>;
    gameState: any;
    bottom: Seat;
    editor: EditorApi;
    index: CardIndex;
    onMessage: (msg: string) => void;
    optimistic: IOptimistic;
}

type ZoneKind = 'groundArena' | 'spaceArena' | 'hand' | 'resources' | 'discard' | 'deck';
const ZONE_FOR: Record<ZoneKind, PileZone> = { groundArena: 'ground', spaceArena: 'space', hand: 'hand', resources: 'resources', discard: 'discard', deck: 'deck' };
const CHIP_LABEL: Record<ZoneKind, string> = { groundArena: 'Ground', spaceArena: 'Space', hand: 'Hand', resources: 'Resource', discard: 'Discard', deck: 'Deck' };

interface IChip { key: string; seat: Seat; kind: ZoneKind; x: number; y: number }
interface IPos { top: number; left: number }
interface IRect { x: number; y: number; w: number; h: number }
type PopoverState =
    | null
    | { kind: 'inspector'; pos: IPos }
    | { kind: 'search'; pos: IPos }
    | { kind: 'swap'; uuid: string; pos: IPos }
    | { kind: 'deck'; seat: Seat; pos: IPos }
    | { kind: 'filler'; seat: Seat; exhausted: boolean; pos: IPos };

/** What a board card is, for choosing its quick controls and swap candidates. */
interface ICardInfo {
    uuid: string;
    ref: EditRef;
    where: string;
    name: string;
    damage: number;
    exhausted: boolean;
    unitLike: boolean;
}

const KINDS_FOR_SWAP = (where: string): { kinds: CardKind[]; arena?: 'ground' | 'space' } => {
    switch (where) {
        case 'groundArena': return { kinds: ['unit', 'tokenUnit'], arena: 'ground' };
        case 'spaceArena': return { kinds: ['unit', 'tokenUnit'], arena: 'space' };
        case 'leader':
        case 'deployedLeader': return { kinds: ['leader'] };
        case 'base': return { kinds: ['base'] };
        default: return { kinds: ['unit', 'upgrade', 'event'] };
    }
};

const ctrlSx = {
    width: 22,
    height: 22,
    minWidth: 0,
    p: 0,
    borderRadius: '6px',
    color: '#fff',
    background: 'rgba(0,0,0,0.82)',
    border: '1px solid rgba(255,255,255,0.28)',
    pointerEvents: 'auto' as const,
    '&:hover': { background: 'rgba(30,45,50,0.98)', borderColor: 'var(--selection-blue)' },
    '& svg': { width: 14, height: 14 },
};

/**
 * Edit affordances on the real Karabast board, built for speed:
 * - hover a card: one-click controls on it (remove, swap, damage -/+, exhaust, +Shield, +Experience, more…);
 * - click a card: a picker to swap it in place, with search focused;
 * - "+" chips on every zone add cards;
 * - keys on the hovered card: Delete, [ ], E, S, X.
 * Every quick edit changes the model and patches the shown board in the same render (optimistic); the engine's
 * real state for the new position replaces the patch a moment later.
 */
const EditOverlay: React.FC<IEditOverlayProps> = ({ containerRef, gameState, bottom, editor, index, onMessage, optimistic }) => {
    const [chips, setChips] = useState<IChip[]>([]);
    const [popover, setPopover] = useState<PopoverState>(null);
    const [hover, setHover] = useState<{ uuid: string; rect: IRect } | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const game = useGameOptional();
    const latest = useRef({ gameState, editor });
    latest.current = { gameState, editor };
    const hideTimer = useRef<number | undefined>(undefined);
    const hoverRef = useRef(hover);
    hoverRef.current = hover;
    const popoverRef = useRef(popover);
    popoverRef.current = popover;

    // ---------------- geometry ----------------

    const rectOf = useCallback((el: Element): IRect | null => {
        const container = containerRef.current;
        if (!container) {
            return null;
        }
        const base = container.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
    }, [containerRef]);

    const recompute = useCallback(() => {
        const container = containerRef.current;
        if (!container) {
            return;
        }
        const base = container.getBoundingClientRect();
        const out: IChip[] = [];
        container.querySelectorAll<HTMLElement>('[data-zone]').forEach((el) => {
            const kind = el.dataset.zone as ZoneKind;
            const seat = el.dataset.zonePlayer as Seat;
            if (!ZONE_FOR[kind] || (seat !== 'p1' && seat !== 'p2') || el.closest('[data-edit-chrome]')) {
                return;
            }
            const r = el.getBoundingClientRect();
            const top = seat !== bottom;
            let x = r.left - base.left;
            let y = r.top - base.top;
            if (kind === 'groundArena' || kind === 'spaceArena') {
                x += 6;
                y = top ? r.top - base.top - 30 : r.bottom - base.top + 6;
            } else if (kind === 'hand') {
                x += 4;
                y += top ? 4 : 2;
            } else if (kind === 'resources') {
                x = r.right - base.left + 4;
                y += Math.max(0, r.height / 2 - 11);
            } else {
                x = r.right - base.left - 16;
                y -= 8;
            }
            out.push({ key: `${seat}-${kind}`, seat, kind, x, y });
        });
        setChips((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
        // keep the hover controls on their card as the board re-renders
        setHover((h) => {
            if (!h) {
                return h;
            }
            const el = container.querySelector(`[data-card-uuid="${CSS.escape(h.uuid)}"]`);
            const rect = el ? rectOf(el) : null;
            if (!rect) {
                return null;
            }
            return rect.x === h.rect.x && rect.y === h.rect.y && rect.w === h.rect.w && rect.h === h.rect.h ? h : { uuid: h.uuid, rect };
        });
    }, [containerRef, bottom, rectOf]);

    useLayoutEffect(() => {
        recompute();
    }, [gameState, recompute]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) {
            return;
        }
        const ro = new ResizeObserver(() => recompute());
        ro.observe(container);
        window.addEventListener('resize', recompute);
        return () => {
            ro.disconnect();
            window.removeEventListener('resize', recompute);
        };
    }, [containerRef, recompute]);

    // ---------------- card info and quick edits ----------------

    const infoFor = useCallback((uuid: string): ICardInfo | null => {
        const { gameState: gs, editor: ed } = latest.current;
        const located = locateInView(gs, uuid);
        if (!located) {
            return null;
        }
        const ref = mapViewCardToEditor(gs, uuid, ed.position, index);
        const card = located.card;
        const deployedLeader = located.where === 'leader' && card.zone !== 'base';
        const leaderInArena = (located.where === 'groundArena' || located.where === 'spaceArena') && ref.kind === 'card' && ref.zone === 'leader';
        return {
            uuid,
            ref,
            where: deployedLeader || leaderInArena ? 'deployedLeader' : located.where,
            name: card.name ?? '',
            damage: card.damage ?? 0,
            exhausted: !!card.exhausted,
            unitLike: located.where === 'groundArena' || located.where === 'spaceArena' || deployedLeader,
        };
    }, [index]);

    const modelCard = (ref: EditRef): IPosCard | null => (ref.kind === 'card' ? findCard(latest.current.editor.position, ref.uid)?.card ?? null : null);

    const ops = {
        remove: (uuid: string) => {
            const info = infoFor(uuid);
            if (!info) {
                return;
            }
            if (info.ref.kind === 'card' && info.ref.zone !== 'leader' && info.ref.zone !== 'base') {
                editor.remove(info.ref.uid);
            } else if (info.ref.kind === 'fillerResource') {
                const { seat, exhausted } = info.ref;
                const f = latest.current.editor.position[seat].fillerResources;
                editor.setPlayer(seat, { fillerResources: exhausted ? { ...f, exhausted: Math.max(0, f.exhausted - 1) } : { ...f, ready: Math.max(0, f.ready - 1) } });
            } else {
                return;
            }
            optimistic.commit(patchRemove(uuid));
            setHover((h) => (h?.uuid === uuid ? null : h));
        },
        damage: (uuid: string, delta: number) => {
            const info = infoFor(uuid);
            const card = info ? modelCard(info.ref) : null;
            if (!info || !card || info.ref.kind !== 'card') {
                return;
            }
            const next = Math.max(0, (card.damage ?? 0) + delta);
            if (next === (card.damage ?? 0)) {
                return;
            }
            editor.update(info.ref.uid, { damage: next });
            optimistic.commit(patchDamage(uuid, next - (card.damage ?? 0)));
        },
        exhaust: (uuid: string) => {
            const info = infoFor(uuid);
            if (!info) {
                return;
            }
            if (info.ref.kind === 'card') {
                editor.update(info.ref.uid, { exhausted: !modelCard(info.ref)?.exhausted });
            } else if (info.ref.kind === 'fillerResource') {
                const { seat, exhausted } = info.ref;
                const f = latest.current.editor.position[seat].fillerResources;
                editor.setPlayer(seat, { fillerResources: exhausted
                    ? { ready: f.ready + 1, exhausted: Math.max(0, f.exhausted - 1) }
                    : { ready: Math.max(0, f.ready - 1), exhausted: f.exhausted + 1 } });
            } else {
                return;
            }
            optimistic.commit(patchExhaust(uuid));
        },
        token: (uuid: string, token: 'shield' | 'experience') => {
            const info = infoFor(uuid);
            const tokenCard = index.get(token);
            if (!info || info.ref.kind !== 'card' || !info.unitLike || !tokenCard) {
                return;
            }
            const tempId = optimistic.tempId();
            editor.bumpToken(info.ref.uid, token, 1);
            optimistic.commit(patchAddToken(uuid, tokenCard, tempId));
        },
        swap: (uuid: string, next: ISandboxCard) => {
            const info = infoFor(uuid);
            if (!info) {
                return;
            }
            if (info.ref.kind === 'fillerResource') {
                editor.nameFillerResource(info.ref.seat, next.internalName, info.ref.exhausted);
            } else if (info.ref.kind === 'card') {
                const card = modelCard(info.ref);
                const upgradeHp = (card?.upgrades ?? []).reduce((sum, u) => sum + (index.get(u.card)?.upgradeHp ?? 0), 0);
                const maxDamage = next.hp != null ? next.hp + upgradeHp - 1 : undefined;
                editor.swap(info.ref.uid, next.internalName, { maxDamage, dropUpgrades: !info.unitLike && info.ref.zone !== 'base' && info.ref.zone !== 'leader' });
            } else {
                return;
            }
            optimistic.commit(patchSwap(uuid, next));
            onMessage(`Swapped in ${next.title}`);
        },
    };
    const opsRef = useRef(ops);
    opsRef.current = ops;

    // ---------------- pointer: hover controls, click to swap, tap to show controls ----------------

    useEffect(() => {
        const container = containerRef.current;
        if (!container) {
            return;
        }
        const showFor = (el: Element) => {
            const uuid = (el as HTMLElement).dataset.cardUuid;
            const rect = rectOf(el);
            if (uuid && rect) {
                window.clearTimeout(hideTimer.current);
                setHover((h) => (h?.uuid === uuid && h.rect.x === rect.x && h.rect.y === rect.y ? h : { uuid, rect }));
            }
        };
        const hideSoon = () => {
            window.clearTimeout(hideTimer.current);
            hideTimer.current = window.setTimeout(() => setHover(null), 120);
        };
        const onOver = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest('[data-edit-hover]')) {
                window.clearTimeout(hideTimer.current);
                return;
            }
            const cardEl = target.closest('[data-card-uuid]');
            if (cardEl && !target.closest('[data-edit-chrome]')) {
                showFor(cardEl);
            } else {
                hideSoon();
            }
        };
        const onClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest('[data-edit-chrome]') || target.closest('[data-edit-hover]')) {
                return;
            }
            const cardEl = target.closest('[data-card-uuid]') as HTMLElement | null;
            const uuid = cardEl?.dataset.cardUuid;
            if (!cardEl || !uuid) {
                return;
            }
            e.stopPropagation();
            e.preventDefault();
            if ((e as PointerEvent).pointerType === 'touch') {
                showFor(cardEl);
                return;
            }
            if (uuid.startsWith('opt-')) {
                return;
            }
            const r = cardEl.getBoundingClientRect();
            setPopover({ kind: 'swap', uuid, pos: { top: r.top, left: r.right + 8 } });
        };
        container.addEventListener('mouseover', onOver);
        container.addEventListener('mouseleave', hideSoon);
        container.addEventListener('click', onClick, true);
        return () => {
            container.removeEventListener('mouseover', onOver);
            container.removeEventListener('mouseleave', hideSoon);
            container.removeEventListener('click', onClick, true);
        };
    }, [containerRef, rectOf]);

    // ---------------- keyboard on the hovered card ----------------

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const el = e.target as HTMLElement;
            if ((el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) || e.metaKey || e.ctrlKey || e.altKey) {
                return;
            }
            const uuid = hoverRef.current?.uuid;
            if (!uuid || popoverRef.current) {
                return;
            }
            const key = e.key.toLowerCase();
            const o = opsRef.current;
            if (e.key === 'Delete' || e.key === 'Backspace') {
                o.remove(uuid);
            } else if (key === '[' || (key === 'd' && e.shiftKey)) {
                o.damage(uuid, -1);
            } else if (key === ']' || key === 'd') {
                o.damage(uuid, 1);
            } else if (key === 'e') {
                o.exhaust(uuid);
            } else if (key === 's') {
                o.token(uuid, 'shield');
            } else if (key === 'x') {
                o.token(uuid, 'experience');
            } else {
                return;
            }
            e.preventDefault();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    // the card being swapped keeps Karabast's highlight border
    const highlight = game?.hoveredChatCard.hover;
    const clearHighlight = game?.hoveredChatCard.clear;
    const editingUuid = popover?.kind === 'swap' ? popover.uuid : null;
    useEffect(() => {
        if (editingUuid) {
            highlight?.(editingUuid);
        } else {
            clearHighlight?.();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editingUuid]);

    // the inspector closes itself when its card is removed
    useEffect(() => {
        if (popover?.kind === 'inspector' && !editor.selection) {
            setPopover(null);
        }
    }, [popover, editor.selection]);

    useEffect(() => {
        if (popover?.kind === 'search' || popover?.kind === 'deck') {
            const t = window.setTimeout(() => searchRef.current?.focus(), 30);
            return () => window.clearTimeout(t);
        }
    }, [popover]);

    // ---------------- popovers ----------------

    const cardPos = (uuid: string): IPos => {
        const el = containerRef.current?.querySelector(`[data-card-uuid="${CSS.escape(uuid)}"]`);
        const r = el?.getBoundingClientRect();
        return r ? { top: r.top, left: r.right + 8 } : { top: 200, left: 200 };
    };

    const openMore = (uuid: string) => {
        const info = infoFor(uuid);
        const pos = cardPos(uuid);
        if (info?.ref.kind === 'card') {
            editor.select({ seat: info.ref.seat, zone: info.ref.zone, uid: info.ref.uid, parentUid: info.ref.parentUid });
            setPopover({ kind: 'inspector', pos });
        } else if (info?.ref.kind === 'fillerResource') {
            setPopover({ kind: 'filler', seat: info.ref.seat, exhausted: info.ref.exhausted, pos });
        } else if (info?.ref.kind === 'unknown') {
            onMessage(info.ref.message);
        }
    };

    const chipClick = (chip: IChip, e: React.MouseEvent) => {
        e.stopPropagation();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const pos = { top: r.bottom + 4, left: r.left };
        editor.setTarget({ seat: chip.seat, zone: ZONE_FOR[chip.kind] as EditorZone });
        setPopover(chip.kind === 'deck' ? { kind: 'deck', seat: chip.seat, pos } : { kind: 'search', pos });
    };

    // a card added from the palette shows at once
    const beforeAdd = (card: ISandboxCard, target: ITarget) => {
        if (target.zone === 'leader' || target.zone === 'base' || target.zone === 'upgrade') {
            return;
        }
        optimistic.commit(patchAdd(target.seat, target.zone, card, optimistic.tempId()));
    };

    const popoverProps = (pos: IPos) => ({
        open: true,
        onClose: () => setPopover(null),
        anchorReference: 'anchorPosition' as const,
        anchorPosition: pos,
        transitionDuration: 0,
        transformOrigin: { vertical: 'top' as const, horizontal: 'left' as const },
        slotProps: { paper: { sx: { background: 'transparent', boxShadow: '0 10px 40px rgba(0,0,0,0.7)', overflow: 'visible' }, 'data-edit-chrome': true } as any },
    });

    const hoverInfo = hover ? infoFor(hover.uuid) : null;
    const swapInfo = popover?.kind === 'swap' ? infoFor(popover.uuid) : null;
    const swapFilter = KINDS_FOR_SWAP(swapInfo?.where ?? '');

    return (
        <Box data-edit-chrome sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 40 }}>
            {chips.map((chip) => (
                <Tooltip key={chip.key} title={chip.kind === 'deck' ? `${seatLabel(chip.seat)}'s deck: order and add cards` : `Add a card to ${seatLabel(chip.seat)}'s ${CHIP_LABEL[chip.kind].toLowerCase()}`} disableInteractive>
                    <Box
                        data-testid={`add-${chip.seat}-${ZONE_FOR[chip.kind]}`}
                        onClick={(e) => chipClick(chip, e)}
                        sx={{
                            position: 'absolute', left: chip.x, top: chip.y, pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: '2px',
                            height: 22, px: chip.kind === 'discard' || chip.kind === 'deck' ? '5px' : '7px', borderRadius: '999px', fontSize: '0.68rem',
                            fontWeight: 700, color: '#fff', cursor: 'pointer', background: 'rgba(0,0,0,0.62)', border: `1px solid ${SEAT_COLOR[chip.seat]}99`,
                            opacity: 0.8, whiteSpace: 'nowrap', backdropFilter: 'blur(6px)', '&:hover': { opacity: 1, background: 'rgba(0,0,0,0.85)' },
                        }}
                    >
                        {chip.kind !== 'deck' && <AddIcon sx={{ fontSize: '0.85rem', color: SEAT_COLOR[chip.seat] }} />}
                        {chip.kind === 'discard' ? null : CHIP_LABEL[chip.kind]}
                    </Box>
                </Tooltip>
            ))}

            {hover && hoverInfo && !popover && (
                <HoverControls
                    rect={hover.rect}
                    info={hoverInfo}
                    onRemove={() => ops.remove(hover.uuid)}
                    onSwap={() => setPopover({ kind: 'swap', uuid: hover.uuid, pos: cardPos(hover.uuid) })}
                    onMore={() => openMore(hover.uuid)}
                    onDamage={(d) => ops.damage(hover.uuid, d)}
                    onExhaust={() => ops.exhaust(hover.uuid)}
                    onToken={(t) => ops.token(hover.uuid, t)}
                    onEnter={() => window.clearTimeout(hideTimer.current)}
                    onLeave={() => {
                        window.clearTimeout(hideTimer.current);
                        hideTimer.current = window.setTimeout(() => setHover(null), 120);
                    }}
                />
            )}

            {popover?.kind === 'swap' && (
                <Popover {...popoverProps(popover.pos)}>
                    <SwapPicker
                        index={index}
                        currentName={swapInfo?.name ?? ''}
                        kinds={swapFilter.kinds}
                        arena={swapFilter.arena}
                        onPick={(card) => {
                            ops.swap(popover.uuid, card);
                            setPopover(null);
                        }}
                        onMore={() => openMore(popover.uuid)}
                        onClose={() => setPopover(null)}
                    />
                </Popover>
            )}

            {popover?.kind === 'inspector' && (
                <Popover {...popoverProps(popover.pos)}>
                    <Box sx={{ width: 340 }} data-testid="edit-inspector">
                        <Inspector editor={editor} index={index} onRequestSearch={() => setPopover({ kind: 'search', pos: popover.pos })} />
                    </Box>
                </Popover>
            )}

            {popover?.kind === 'search' && (
                <Popover {...popoverProps(popover.pos)}>
                    <Box sx={{ width: 380, height: 470, display: 'flex' }} data-testid="edit-palette">
                        <CardSearch index={index} editor={editor} inputRef={searchRef} onAdded={(m) => onMessage(`Added ${m}`)} onBeforeAdd={beforeAdd} />
                    </Box>
                </Popover>
            )}

            {popover?.kind === 'deck' && (
                <Popover {...popoverProps(popover.pos)}>
                    <Box sx={{ width: 380, display: 'flex', flexDirection: 'column', gap: '6px' }} data-testid="edit-deck">
                        <DeckList seat={popover.seat} editor={editor} index={index} />
                        <Box sx={{ height: 360, display: 'flex' }}>
                            <CardSearch index={index} editor={editor} inputRef={searchRef} onAdded={(m) => onMessage(`Added ${m}`)} onBeforeAdd={beforeAdd} />
                        </Box>
                    </Box>
                </Popover>
            )}

            {popover?.kind === 'filler' && (
                <Popover {...popoverProps(popover.pos)}>
                    <FillerResources seat={popover.seat} exhausted={popover.exhausted} editor={editor} onDone={() => setPopover(null)} />
                </Popover>
            )}
        </Box>
    );
};

// ---------------- hover controls ----------------

interface IHoverControlsProps {
    rect: IRect;
    info: ICardInfo;
    onRemove: () => void;
    onSwap: () => void;
    onMore: () => void;
    onDamage: (d: number) => void;
    onExhaust: () => void;
    onToken: (t: 'shield' | 'experience') => void;
    onEnter: () => void;
    onLeave: () => void;
}

/** One-click controls drawn on top of a card. Absolutely positioned, so nothing on the board moves. */
const HoverControls: React.FC<IHoverControlsProps> = ({ rect, info, onRemove, onSwap, onMore, onDamage, onExhaust, onToken, onEnter, onLeave }) => {
    const where = info.where;
    const canRemove = where !== 'leader' && where !== 'base' && where !== 'deployedLeader' && info.ref.kind !== 'unknown';
    const canDamage = info.unitLike || where === 'base' || where === 'deployedLeader';
    const canExhaust = info.unitLike || where === 'resources' || where === 'leader' || where === 'deployedLeader';
    const canToken = info.unitLike && where !== 'deployedLeader';
    const stop = (fn: () => void) => (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        fn();
    };
    const compact = rect.w < 70;
    return (
        <Box
            data-edit-hover
            data-testid="hover-controls"
            onMouseEnter={onEnter}
            onMouseLeave={onLeave}
            sx={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, pointerEvents: 'none', outline: '2px solid rgba(102,229,255,0.55)', borderRadius: '6px' }}
        >
            <Box sx={{ position: 'absolute', top: -8, left: -6, display: 'flex', gap: '3px' }}>
                <Tooltip title="Swap for another card (or click the card)" disableInteractive>
                    <Button sx={ctrlSx} onClick={stop(onSwap)} data-testid="hover-swap" aria-label="Swap card"><SwapHorizIcon /></Button>
                </Tooltip>
                <Tooltip title="More: upgrades, owner, move…" disableInteractive>
                    <Button sx={ctrlSx} onClick={stop(onMore)} data-testid="hover-more" aria-label="More options"><MoreHorizIcon /></Button>
                </Tooltip>
            </Box>
            {canRemove && (
                <Box sx={{ position: 'absolute', top: -8, right: -6 }}>
                    <Tooltip title="Remove (Delete)" disableInteractive>
                        <Button sx={{ ...ctrlSx, '&:hover': { background: '#7a1010', borderColor: '#ff6b6b' } }} onClick={stop(onRemove)} data-testid="hover-remove" aria-label="Remove card"><CloseIcon /></Button>
                    </Tooltip>
                </Box>
            )}
            {(canDamage || canExhaust || canToken) && (
                <Box sx={{ position: 'absolute', bottom: -10, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '3px', flexWrap: compact ? 'wrap' : 'nowrap', justifyContent: 'center', width: compact ? Math.max(rect.w + 24, 76) : 'max-content' }}>
                    {canDamage && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: '1px', pointerEvents: 'auto', background: 'rgba(0,0,0,0.82)', borderRadius: '6px', border: '1px solid rgba(255,80,80,0.6)' }}>
                            <Tooltip title="Less damage ( [ )" disableInteractive>
                                <Button sx={{ ...ctrlSx, border: 'none', background: 'transparent' }} onClick={stop(() => onDamage(-1))} data-testid="hover-damage-minus" aria-label="Less damage"><RemoveIcon /></Button>
                            </Tooltip>
                            <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, m: 0, minWidth: '0.9rem', textAlign: 'center', color: '#ff8080' }} data-testid="hover-damage-value">{info.damage}</Typography>
                            <Tooltip title="More damage ( ] )" disableInteractive>
                                <Button sx={{ ...ctrlSx, border: 'none', background: 'transparent' }} onClick={stop(() => onDamage(1))} data-testid="hover-damage-plus" aria-label="More damage"><AddIcon /></Button>
                            </Tooltip>
                        </Box>
                    )}
                    {canExhaust && (
                        <Tooltip title={info.exhausted ? 'Ready (E)' : 'Exhaust (E)'} disableInteractive>
                            <Button sx={{ ...ctrlSx, width: 'auto', px: '4px', fontSize: '0.6rem', fontWeight: 800, color: info.exhausted ? 'var(--selection-yellow)' : '#fff' }} onClick={stop(onExhaust)} data-testid="hover-exhaust" aria-label="Toggle exhausted">
                                {info.exhausted ? 'READY' : 'EXH'}
                            </Button>
                        </Tooltip>
                    )}
                    {canToken && (
                        <>
                            <Tooltip title="+ Shield (S)" disableInteractive>
                                <Button sx={{ ...ctrlSx, color: '#00A6EC' }} onClick={stop(() => onToken('shield'))} data-testid="hover-shield" aria-label="Add Shield"><ShieldIcon /></Button>
                            </Tooltip>
                            <Tooltip title="+ Experience (X)" disableInteractive>
                                <Button sx={{ ...ctrlSx, color: '#2fd136' }} onClick={stop(() => onToken('experience'))} data-testid="hover-experience" aria-label="Add Experience"><ExperienceIcon /></Button>
                            </Tooltip>
                        </>
                    )}
                </Box>
            )}
        </Box>
    );
};

// ---------------- small popovers ----------------

const Stepper: React.FC<{ label: string; value: number; onChange: (v: number) => void }> = ({ label, value, onChange }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <IconButton size="small" sx={{ p: '2px', color: '#fff', background: 'rgba(255,255,255,0.08)' }} onClick={() => onChange(Math.max(0, value - 1))} aria-label={`fewer ${label}`}><RemoveIcon sx={{ fontSize: '0.9rem' }} /></IconButton>
        <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, minWidth: '1.6rem', textAlign: 'center', m: 0 }}>{value}</Typography>
        <IconButton size="small" sx={{ p: '2px', color: '#fff', background: 'rgba(255,255,255,0.08)' }} onClick={() => onChange(value + 1)} aria-label={`more ${label}`}><AddIcon sx={{ fontSize: '0.9rem' }} /></IconButton>
        <Typography sx={{ fontSize: '0.75rem', m: 0, color: 'rgba(255,255,255,0.65)' }}>{label}</Typography>
    </Box>
);

const FillerResources: React.FC<{ seat: Seat; exhausted: boolean; editor: EditorApi; onDone: () => void }> = ({ seat, exhausted, editor, onDone }) => {
    const f = editor.position[seat].fillerResources;
    const set = (patch: Partial<typeof f>) => editor.setPlayer(seat, { fillerResources: { ...f, ...patch } });
    return (
        <Box sx={{ ...panelSx, p: '10px 12px', width: 300, display: 'flex', flexDirection: 'column', gap: '6px' }} data-testid="edit-filler">
            <Typography sx={{ fontWeight: 800, fontSize: '0.92rem', m: 0 }}>Underworld Thug <Box component="span" sx={{ color: 'rgba(255,255,255,0.5)', fontWeight: 400 }}>(plain resource)</Box></Typography>
            <Typography sx={{ fontSize: '0.72rem', m: 0, color: 'rgba(255,255,255,0.55)' }}>{seatLabel(seat)}&apos;s unnamed resources. Swap one for a named card when its text matters (Plot, Smuggle).</Typography>
            <Stepper label="ready" value={f.ready} onChange={(v) => set({ ready: v })} />
            <Stepper label="exhausted" value={f.exhausted} onChange={(v) => set({ exhausted: v })} />
            <Box sx={{ display: 'flex', gap: '6px', mt: '2px' }}>
                <Button size="small" sx={pillButtonSx} onClick={() => {
                    set(exhausted ? { exhausted: Math.max(0, f.exhausted - 1), ready: f.ready + 1 } : { ready: Math.max(0, f.ready - 1), exhausted: f.exhausted + 1 });
                    onDone();
                }}>{exhausted ? 'Ready this one' : 'Exhaust this one'}</Button>
            </Box>
        </Box>
    );
};

const DeckList: React.FC<{ seat: Seat; editor: EditorApi; index: CardIndex }> = ({ seat, editor, index }) => {
    const p = editor.position[seat];
    return (
        <Box sx={{ ...panelSx, p: '10px 12px' }}>
            <Typography sx={sectionTitleSx}>{seatLabel(seat)}&apos;s deck, top card first</Typography>
            {p.deck.length === 0 && <Typography sx={{ fontSize: '0.75rem', m: '4px 0', color: 'rgba(255,255,255,0.5)' }}>No named cards. Add one below to control the next draw.</Typography>}
            {p.deck.map((c, i) => {
                const card = index.get(c.card);
                return (
                    <Box key={c.uid} sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Typography sx={{ fontSize: '0.78rem', m: 0, color: 'rgba(255,255,255,0.45)', width: '1.3rem' }}>{i + 1}.</Typography>
                        <Typography sx={{ fontSize: '0.8rem', m: 0, flex: 1 }}>{card ? displayName(card) : c.card}</Typography>
                        <IconButton size="small" sx={{ p: '1px', color: '#fff' }} onClick={() => editor.reorder(seat, 'deck', c.uid, -1)} aria-label="Move up"><ArrowUpwardIcon sx={{ fontSize: '0.9rem' }} /></IconButton>
                        <IconButton size="small" sx={{ p: '1px', color: '#fff' }} onClick={() => editor.reorder(seat, 'deck', c.uid, 1)} aria-label="Move down"><ArrowDownwardIcon sx={{ fontSize: '0.9rem' }} /></IconButton>
                        <IconButton size="small" sx={{ p: '1px', color: '#ff8a8a' }} onClick={() => editor.remove(c.uid)} aria-label="Remove"><DeleteOutlineIcon sx={{ fontSize: '0.9rem' }} /></IconButton>
                    </Box>
                );
            })}
            <Box sx={{ mt: '4px' }}>
                <Stepper label="plain cards underneath" value={p.fillerDeck} onChange={(v) => editor.setPlayer(seat, { fillerDeck: v })} />
            </Box>
        </Box>
    );
};

export default EditOverlay;
