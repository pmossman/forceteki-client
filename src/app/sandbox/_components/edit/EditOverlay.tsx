'use client';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, Button, IconButton, Popover, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { useGameOptional } from '@/app/_contexts/Game.context';
import { Seat, seatLabel } from '../../_engine/SandboxEngine';
import { CardIndex, displayName } from '../../_lib/cardIndex';
import { EditorZone, PileZone } from '../../_lib/position';
import { EditorApi } from '../../_lib/useEditor';
import { mapViewCardToEditor } from '../../_lib/viewMapping';
import CardSearch from '../editor/CardSearch';
import Inspector from '../editor/Inspector';
import { SEAT_COLOR, panelSx, pillButtonSx, sectionTitleSx } from '../sandboxTheme';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface IEditOverlayProps {

    /** the board container: zones and cards inside it get edit affordances */
    containerRef: React.RefObject<HTMLDivElement>;
    gameState: any;
    bottom: Seat;
    editor: EditorApi;
    index: CardIndex;
    onMessage: (msg: string) => void;
}

type ZoneKind = 'groundArena' | 'spaceArena' | 'hand' | 'resources' | 'discard' | 'deck';
const ZONE_FOR: Record<ZoneKind, PileZone> = { groundArena: 'ground', spaceArena: 'space', hand: 'hand', resources: 'resources', discard: 'discard', deck: 'deck' };
const CHIP_LABEL: Record<ZoneKind, string> = { groundArena: 'Ground', spaceArena: 'Space', hand: 'Hand', resources: 'Resource', discard: 'Discard', deck: 'Deck' };

interface IChip { key: string; seat: Seat; kind: ZoneKind; x: number; y: number }
interface IPos { top: number; left: number }
type PopoverState =
    | null
    | { kind: 'inspector'; pos: IPos }
    | { kind: 'search'; pos: IPos }
    | { kind: 'deck'; seat: Seat; pos: IPos }
    | { kind: 'filler'; seat: Seat; exhausted: boolean; pos: IPos };

/**
 * Edit affordances drawn over the real Karabast board: a small "+" chip on every zone (opens the card
 * palette for that zone), and click-a-card to get a compact inspector. Clicks on cards are caught before
 * the board's own handlers (the board is inert in Edit mode anyway).
 */
const EditOverlay: React.FC<IEditOverlayProps> = ({ containerRef, gameState, bottom, editor, index, onMessage }) => {
    const [chips, setChips] = useState<IChip[]>([]);
    const [popover, setPopover] = useState<PopoverState>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const game = useGameOptional();
    const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
    const latest = useRef({ gameState, editor });
    latest.current = { gameState, editor };

    // ---- where the zones are on screen
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
    }, [containerRef, bottom]);

    useLayoutEffect(() => {
        recompute();
        const t = window.setTimeout(recompute, 120);
        return () => window.clearTimeout(t);
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

    // ---- click a card -> inspector
    useEffect(() => {
        const container = containerRef.current;
        if (!container) {
            return;
        }
        const onClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest('[data-edit-chrome]')) {
                return;
            }
            const cardEl = target.closest('[data-card-uuid]') as HTMLElement | null;
            const uuid = cardEl?.dataset.cardUuid;
            if (!cardEl || !uuid) {
                return;
            }
            e.stopPropagation();
            e.preventDefault();
            const { gameState: gs, editor: ed } = latest.current;
            const ref = mapViewCardToEditor(gs, uuid, ed.position, index);
            const r = cardEl.getBoundingClientRect();
            const pos = { top: r.top + Math.min(r.height / 2, 60), left: r.right + 8 };
            if (ref.kind === 'card') {
                ed.select({ seat: ref.seat, zone: ref.zone, uid: ref.uid, parentUid: ref.parentUid });
                setSelectedUuid(uuid);
                setPopover({ kind: 'inspector', pos });
            } else if (ref.kind === 'fillerResource') {
                setPopover({ kind: 'filler', seat: ref.seat, exhausted: ref.exhausted, pos });
            } else {
                onMessage(ref.message);
            }
        };
        container.addEventListener('click', onClick, true);
        return () => container.removeEventListener('click', onClick, true);
    }, [containerRef, index, onMessage]);

    // the card being edited keeps Karabast's highlight border while its inspector is open
    const hover = game?.hoveredChatCard.hover;
    const clearHover = game?.hoveredChatCard.clear;
    useEffect(() => {
        if (popover?.kind === 'inspector' && selectedUuid) {
            hover?.(selectedUuid);
        } else {
            clearHover?.();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [popover?.kind, selectedUuid]);

    // the inspector closes itself when its card is removed
    useEffect(() => {
        if (popover?.kind === 'inspector' && !editor.selection) {
            setPopover(null);
        }
    }, [popover, editor.selection]);

    useEffect(() => {
        if (popover?.kind === 'search' || popover?.kind === 'deck') {
            const t = window.setTimeout(() => searchRef.current?.focus(), 60);
            return () => window.clearTimeout(t);
        }
    }, [popover]);

    const openSearch = (seat: Seat, zone: EditorZone | 'upgrade', pos: IPos, parentUid?: string) => {
        editor.setTarget({ seat, zone, parentUid });
        setPopover({ kind: 'search', pos });
    };

    const chipClick = (chip: IChip, e: React.MouseEvent) => {
        e.stopPropagation();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const pos = { top: r.bottom + 4, left: r.left };
        if (chip.kind === 'deck') {
            editor.setTarget({ seat: chip.seat, zone: 'deck' });
            setPopover({ kind: 'deck', seat: chip.seat, pos });
        } else {
            openSearch(chip.seat, ZONE_FOR[chip.kind], pos);
        }
    };

    const popoverProps = (pos: IPos) => ({
        open: true,
        onClose: () => setPopover(null),
        anchorReference: 'anchorPosition' as const,
        anchorPosition: pos,
        transformOrigin: { vertical: 'top' as const, horizontal: 'left' as const },
        slotProps: { paper: { sx: { background: 'transparent', boxShadow: '0 10px 40px rgba(0,0,0,0.7)', overflow: 'visible' }, 'data-edit-chrome': true } as any },
    });

    return (
        <Box data-edit-chrome sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 9 }}>
            {chips.map((chip) => (
                <Tooltip key={chip.key} title={chip.kind === 'deck' ? `${seatLabel(chip.seat)}'s deck: order and add cards` : `Add a card to ${seatLabel(chip.seat)}'s ${CHIP_LABEL[chip.kind].toLowerCase()}`}>
                    <Box
                        data-testid={`add-${chip.seat}-${ZONE_FOR[chip.kind]}`}
                        onClick={(e) => chipClick(chip, e)}
                        sx={{
                            position: 'absolute',
                            left: chip.x,
                            top: chip.y,
                            pointerEvents: 'auto',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '2px',
                            height: 22,
                            px: chip.kind === 'discard' || chip.kind === 'deck' ? '5px' : '7px',
                            borderRadius: '999px',
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            color: '#fff',
                            cursor: 'pointer',
                            background: 'rgba(0,0,0,0.62)',
                            border: `1px solid ${SEAT_COLOR[chip.seat]}99`,
                            opacity: 0.8,
                            whiteSpace: 'nowrap',
                            backdropFilter: 'blur(6px)',
                            transition: 'opacity 0.15s, background 0.15s',
                            '&:hover': { opacity: 1, background: 'rgba(0,0,0,0.85)' },
                        }}
                    >
                        {chip.kind !== 'deck' && <AddIcon sx={{ fontSize: '0.85rem', color: SEAT_COLOR[chip.seat] }} />}
                        {chip.kind === 'discard' ? null : CHIP_LABEL[chip.kind]}
                    </Box>
                </Tooltip>
            ))}

            {popover?.kind === 'inspector' && (
                <Popover {...popoverProps(popover.pos)}>
                    <Box sx={{ width: 340 }} data-testid="edit-inspector">
                        <Inspector
                            editor={editor}
                            index={index}
                            onRequestSearch={() => setPopover({ kind: 'search', pos: popover.pos })}
                        />
                    </Box>
                </Popover>
            )}

            {popover?.kind === 'search' && (
                <Popover {...popoverProps(popover.pos)}>
                    <Box sx={{ width: 380, height: 470, display: 'flex' }} data-testid="edit-palette">
                        <CardSearch index={index} editor={editor} inputRef={searchRef} onAdded={(m) => onMessage(`Added ${m}`)} />
                    </Box>
                </Popover>
            )}

            {popover?.kind === 'deck' && (
                <Popover {...popoverProps(popover.pos)}>
                    <Box sx={{ width: 380, display: 'flex', flexDirection: 'column', gap: '6px' }} data-testid="edit-deck">
                        <DeckList seat={popover.seat} editor={editor} index={index} />
                        <Box sx={{ height: 360, display: 'flex' }}>
                            <CardSearch index={index} editor={editor} inputRef={searchRef} onAdded={(m) => onMessage(`Added ${m}`)} />
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
            <Typography sx={{ fontSize: '0.72rem', m: 0, color: 'rgba(255,255,255,0.55)' }}>{seatLabel(seat)}&apos;s unnamed resources. Name a card (+ Resource) when its text matters, e.g. Plot or Smuggle.</Typography>
            <Stepper label="ready" value={f.ready} onChange={(v) => set({ ready: v })} />
            <Stepper label="exhausted" value={f.exhausted} onChange={(v) => set({ exhausted: v })} />
            <Box sx={{ display: 'flex', gap: '6px', mt: '2px' }}>
                <Button size="small" sx={pillButtonSx} onClick={() => {
                    set(exhausted ? { exhausted: Math.max(0, f.exhausted - 1), ready: f.ready + 1 } : { ready: Math.max(0, f.ready - 1), exhausted: f.exhausted + 1 });
                    onDone();
                }}>{exhausted ? 'Ready this one' : 'Exhaust this one'}</Button>
                <Button size="small" sx={{ ...pillButtonSx, color: '#ff9b9b' }} onClick={() => {
                    set(exhausted ? { exhausted: Math.max(0, f.exhausted - 1) } : { ready: Math.max(0, f.ready - 1) });
                    onDone();
                }}>Remove one</Button>
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
