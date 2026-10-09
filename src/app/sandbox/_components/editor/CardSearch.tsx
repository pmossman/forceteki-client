'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { Box, InputBase, MenuItem, Select, Tooltip, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useCardImageLocale } from '@/app/_contexts/CardImageLocale.context';
import { Seat, seatLabel } from '../../_engine/SandboxEngine';
import { CardIndex, CardKind, ISandboxCard, cardImageUrl, cardKind, setCodeLabel } from '../../_lib/cardIndex';
import { EditorZone, ZONE_LABELS } from '../../_lib/position';
import { EditorApi, ITarget, findCard } from '../../_lib/useEditor';
import { SEAT_COLOR, panelSx, sectionTitleSx } from '../sandboxTheme';

const KINDS_FOR_TARGET: Record<EditorZone | 'upgrade', CardKind[]> = {
    leader: ['leader'],
    base: ['base'],
    ground: ['unit', 'tokenUnit'],
    space: ['unit', 'tokenUnit'],
    upgrade: ['upgrade', 'tokenUpgrade', 'unit'],
    hand: ['unit', 'upgrade', 'event'],
    resources: ['unit', 'upgrade', 'event'],
    discard: ['unit', 'upgrade', 'event'],
    deck: ['unit', 'upgrade', 'event'],
};

const KIND_LABEL: Partial<Record<CardKind, string>> = {
    unit: 'Unit', upgrade: 'Upgrade', event: 'Event', leader: 'Leader', base: 'Base', tokenUnit: 'Token unit', tokenUpgrade: 'Token upgrade',
};

interface ICardSearchProps {
    index: CardIndex;
    editor: EditorApi;
    inputRef: React.RefObject<HTMLInputElement>;
    onAdded: (message: string) => void;

    /** called before the model changes, so a caller can show the card at once (optimistic) */
    onBeforeAdd?: (card: ISandboxCard, target: ITarget) => void;
}

const CardSearch: React.FC<ICardSearchProps> = ({ index, editor, inputRef, onAdded, onBeforeAdd }) => {
    const locale = useCardImageLocale();
    const [query, setQuery] = useState('');
    const [anyKind, setAnyKind] = useState(false);
    const [highlight, setHighlight] = useState(0);
    const target = editor.target;

    const parentForUpgrade = target.zone === 'upgrade' && target.parentUid ? findCard(editor.position, target.parentUid) : null;
    const zoneForFilter = target.zone;
    const arena = target.zone === 'ground' ? 'ground' : target.zone === 'space' ? 'space' : undefined;

    const results = useMemo(
        () => index.search(query, { kinds: anyKind ? undefined : KINDS_FOR_TARGET[zoneForFilter], arena: anyKind ? undefined : arena, limit: 80 }),
        [index, query, anyKind, zoneForFilter, arena]
    );

    useEffect(() => setHighlight(0), [query, zoneForFilter, anyKind]);

    const add = (card: ISandboxCard) => {
        onBeforeAdd?.(card, target);
        const where = `${seatLabel(target.seat)} ${target.zone === 'upgrade' ? 'upgrade' : ZONE_LABELS[target.zone as EditorZone].toLowerCase()}`;
        if (target.zone === 'upgrade') {
            if (!target.parentUid) {
                return;
            }
            const uid = editor.attach(target.parentUid, card.internalName);
            editor.select({ seat: target.seat, zone: parentForUpgrade?.zone ?? 'ground', uid, parentUid: target.parentUid });
        } else {
            const uid = editor.place(target.seat, target.zone, card.internalName);
            editor.select({ seat: target.seat, zone: target.zone, uid });
            // leader and base are single slots: after choosing one, move on to the arena
        }
        onAdded(`${card.title} → ${where}`);
    };

    const targetZones: (EditorZone | 'upgrade')[] = ['leader', 'base', 'ground', 'space', 'hand', 'resources', 'discard', 'deck'];
    if (target.zone === 'upgrade') {
        targetZones.push('upgrade');
    }

    const styles = {
        root: { ...panelSx, display: 'flex', flexDirection: 'column' as const, minHeight: 0, flex: 1, p: '10px' },
        targetRow: { display: 'flex', alignItems: 'center', gap: '6px', mb: '8px', flexWrap: 'wrap' as const },
        seatChip: (seat: Seat) => ({
            px: '8px',
            borderRadius: '999px',
            fontWeight: 800,
            fontSize: '0.75rem',
            cursor: 'pointer',
            border: `1.5px solid ${SEAT_COLOR[seat]}`,
            color: target.seat === seat ? '#000' : SEAT_COLOR[seat],
            background: target.seat === seat ? SEAT_COLOR[seat] : 'transparent',
        }),
        input: {
            display: 'flex', alignItems: 'center', gap: '6px', px: '10px', py: '4px', borderRadius: '8px',
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)', mb: '6px',
        },
        row: (hl: boolean) => ({
            display: 'flex', gap: '8px', alignItems: 'center', p: '4px 6px', borderRadius: '6px', cursor: 'pointer',
            background: hl ? 'rgba(102,229,255,0.16)' : 'transparent',
            '&:hover': { background: 'rgba(255,255,255,0.10)' },
        }),
        thumb: (url: string, landscape: boolean) => ({
            width: landscape ? 46 : 32, height: landscape ? 33 : 45, flex: '0 0 auto', borderRadius: '4px',
            backgroundImage: `url(${url})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundColor: '#222',
        }),
    };

    return (
        <Box sx={styles.root} data-testid="card-search">
            <Box sx={styles.targetRow}>
                <Typography sx={sectionTitleSx}>Add to</Typography>
                {(['p1', 'p2'] as Seat[]).map((seat) => (
                    <Box key={seat} sx={styles.seatChip(seat)} onClick={() => editor.setTarget({ ...target, seat, zone: target.zone === 'upgrade' ? 'ground' : target.zone })}>
                        {seatLabel(seat)}
                    </Box>
                ))}
                <Select
                    size="small"
                    value={target.zone}
                    onChange={(e) => editor.setTarget({ seat: target.seat, zone: e.target.value as EditorZone })}
                    variant="standard"
                    disableUnderline
                    sx={{ color: '#fff', fontSize: '0.85rem', fontWeight: 600, '& .MuiSelect-icon': { color: '#fff' } }}
                    data-testid="search-target-zone"
                >
                    {targetZones.map((z) => (
                        <MenuItem key={z} value={z}>
                            {z === 'upgrade' ? `Upgrade on ${parentForUpgrade ? (index.get(parentForUpgrade.card.card)?.title ?? 'unit') : 'unit'}` : ZONE_LABELS[z]}
                        </MenuItem>
                    ))}
                </Select>
                <Box sx={{ flex: 1 }} />
                <Tooltip title="Ignore the zone's card-type filter">
                    <Typography
                        onClick={() => setAnyKind(!anyKind)}
                        sx={{ fontSize: '0.7rem', cursor: 'pointer', m: 0, color: anyKind ? 'var(--selection-blue)' : 'rgba(255,255,255,0.5)' }}
                    >
                        {anyKind ? 'all types' : 'filtered'}
                    </Typography>
                </Tooltip>
            </Box>
            <Box sx={styles.input}>
                <SearchIcon sx={{ fontSize: '1.1rem', opacity: 0.7 }} />
                <InputBase
                    inputRef={inputRef}
                    placeholder="Search cards by name, set code, trait…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setHighlight((h) => Math.min(results.length - 1, h + 1));
                        } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setHighlight((h) => Math.max(0, h - 1));
                        } else if (e.key === 'Enter' && results[highlight]) {
                            e.preventDefault();
                            add(results[highlight]);
                        } else if (e.key === 'Escape') {
                            (e.target as HTMLInputElement).blur();
                        }
                        e.stopPropagation();
                    }}
                    sx={{ color: '#fff', flex: 1, fontSize: '0.95rem' }}
                    inputProps={{ 'data-testid': 'card-search-input', 'aria-label': 'Search cards' }}
                />
            </Box>
            <Box sx={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
                {results.length === 0 && (
                    <Typography sx={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)', p: 1 }}>
                        No cards match{anyKind ? '' : ' for this zone (try “all types”)'}.
                    </Typography>
                )}
                {results.map((card, i) => {
                    const kind = cardKind(card);
                    const landscape = kind === 'leader' || kind === 'base';
                    const url = cardImageUrl(card, locale);
                    const stats = [card.cost != null && kind !== 'base' ? `${card.cost}◆` : null,
                        card.power != null && (kind === 'unit' || kind === 'tokenUnit' || kind === 'leader') ? `${card.power}/${card.hp}` : null,
                        kind === 'base' && card.hp ? `${card.hp} HP` : null].filter(Boolean).join(' · ');
                    return (
                        <Tooltip
                            key={card.internalName}
                            placement="left"
                            enterDelay={500}
                            enterNextDelay={250}
                            title={<Box sx={{ width: landscape ? 300 : 220, aspectRatio: landscape ? '1.4/1' : '1/1.4', backgroundImage: `url(${url})`, backgroundSize: 'cover', borderRadius: '10px' }} />}
                            slotProps={{ tooltip: { sx: { background: 'transparent', p: 0, maxWidth: 'none' } } }}
                        >
                            <Box
                                sx={styles.row(i === highlight)}
                                onClick={() => add(card)}
                                draggable
                                onDragStart={(e) => e.dataTransfer.setData('application/x-sandbox-card', card.internalName)}
                                data-testid={`search-result-${card.internalName}`}
                            >
                                <Box sx={styles.thumb(url, landscape)} />
                                <Box sx={{ minWidth: 0, flex: 1 }}>
                                    <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, m: 0, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {card.unique ? '◆ ' : ''}{card.title}
                                    </Typography>
                                    {card.subtitle && (
                                        <Typography sx={{ fontSize: '0.74rem', m: 0, lineHeight: 1.2, color: 'rgba(255,255,255,0.7)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {card.subtitle}
                                        </Typography>
                                    )}
                                    <Typography sx={{ fontSize: '0.66rem', m: 0, color: 'rgba(255,255,255,0.45)' }}>
                                        {setCodeLabel(card)} · {KIND_LABEL[kind] ?? kind}{card.arena && kind !== 'leader' ? ` · ${card.arena}` : ''}{stats ? ` · ${stats}` : ''}
                                    </Typography>
                                </Box>
                            </Box>
                        </Tooltip>
                    );
                })}
            </Box>
            <Typography sx={{ fontSize: '0.66rem', color: 'rgba(255,255,255,0.4)', mt: '6px', mb: 0 }}>
                Click or press Enter to add to the highlighted zone · drag a result onto any zone · {index.all.length} cards
            </Typography>
        </Box>
    );
};

export default CardSearch;
