'use client';
import React from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import RemoveIcon from '@mui/icons-material/Remove';
import AddIcon from '@mui/icons-material/Add';
import { Seat, seatLabel } from '../../_engine/SandboxEngine';
import { CardIndex } from '../../_lib/cardIndex';
import { EditorZone, PileZone, ZONE_LABELS } from '../../_lib/position';
import { EditorApi } from '../../_lib/useEditor';
import EditorCard from './EditorCard';
import ZoneBox from './ZoneBox';
import { SEAT_COLOR } from '../sandboxTheme';

interface IPlayerHalfProps {
    seat: Seat;
    top: boolean;
    editor: EditorApi;
    index: CardIndex;
    onRequestSearch: () => void;
}

const ARENA_CARD = 'clamp(48px, min(5.4vw, 8.2vh), 96px)';
const TRAY_CARD = 'clamp(34px, min(3.5vw, 5.6vh), 64px)';
const SLOT_CARD = 'clamp(96px, min(9.5vw, 10vh), 168px)';

const Stepper: React.FC<{ label: string; value: number; onChange: (v: number) => void; testId?: string }> = ({ label, value, onChange, testId }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px' }} onClick={(e) => e.stopPropagation()} data-testid={testId}>
        <IconButton size="small" sx={{ p: '1px', color: '#fff' }} onClick={() => onChange(Math.max(0, value - 1))} aria-label={`fewer ${label}`}>
            <RemoveIcon sx={{ fontSize: '0.85rem' }} />
        </IconButton>
        <Typography sx={{ fontSize: '0.72rem', minWidth: '1.6rem', textAlign: 'center', m: 0 }}>{value}</Typography>
        <IconButton size="small" sx={{ p: '1px', color: '#fff' }} onClick={() => onChange(value + 1)} aria-label={`more ${label}`}>
            <AddIcon sx={{ fontSize: '0.85rem' }} />
        </IconButton>
        <Typography sx={{ fontSize: '0.66rem', color: 'rgba(255,255,255,0.55)', m: 0, mr: '4px' }}>{label}</Typography>
    </Box>
);

const PlayerHalf: React.FC<IPlayerHalfProps> = ({ seat, top, editor, index, onRequestSearch }) => {
    const p = editor.position[seat];
    const sel = editor.selection;

    const isTarget = (zone: EditorZone) => editor.target.seat === seat && editor.target.zone === zone;
    const target = (zone: EditorZone) => editor.setTarget({ seat, zone });
    const add = (zone: EditorZone) => {
        target(zone);
        onRequestSearch();
    };
    const drop = (zone: EditorZone) => ({ uid, cardName }: { uid?: string; cardName?: string }) => {
        if (uid && zone !== 'leader' && zone !== 'base') {
            editor.move(uid, seat, zone as PileZone);
        } else if (cardName) {
            const newUid = editor.place(seat, zone, cardName);
            editor.select({ seat, zone, uid: newUid });
        }
    };
    const selectCard = (zone: EditorZone, uid: string, parentUid?: string) => (e?: React.MouseEvent) => {
        e?.stopPropagation();
        editor.select({ seat, zone, uid, parentUid });
        if (zone === 'ground' || zone === 'space' || zone === 'leader') {
            // a selected unit is the natural place to attach the next upgrade
        }
    };

    const pile = (zone: PileZone, cardWidth: string, extra?: React.ReactNode, count?: number | string, contentSx?: object, sx?: object) => (
        <ZoneBox
            seat={seat}
            label={ZONE_LABELS[zone]}
            count={count ?? p[zone].length}
            isTarget={isTarget(zone)}
            onTarget={() => target(zone)}
            onAdd={() => add(zone)}
            onDropCard={drop(zone)}
            extra={extra}
            sx={{ flex: 1, ...sx }}
            contentSx={contentSx}
            testId={`zone-${seat}-${zone}`}
        >
            {p[zone].map((c) => (
                <EditorCard
                    key={c.uid}
                    card={c}
                    index={index}
                    seat={seat}
                    width={cardWidth}
                    selected={sel?.uid === c.uid}
                    selectedUid={sel?.uid}
                    onClick={selectCard(zone, c.uid)}
                    onSelectUpgrade={(uid) => editor.select({ seat, zone, uid, parentUid: c.uid })}
                    testId={`card-${seat}-${zone}-${c.card}`}
                />
            ))}
        </ZoneBox>
    );

    const slot = (zone: 'leader' | 'base') => {
        const c = p[zone];
        return (
            <ZoneBox
                seat={seat}
                label={ZONE_LABELS[zone]}
                isTarget={isTarget(zone)}
                onTarget={() => target(zone)}
                onAdd={() => add(zone)}
                onDropCard={drop(zone)}
                sx={{ alignItems: 'stretch' }}
                contentSx={{ justifyContent: 'center', flexWrap: 'nowrap' }}
                testId={`zone-${seat}-${zone}`}
            >
                {c ? (
                    <EditorCard
                        card={c}
                        index={index}
                        seat={seat}
                        width={zone === 'leader' && c.deployed ? `calc(${SLOT_CARD} * 0.55)` : SLOT_CARD}
                        landscape={!(zone === 'leader' && c.deployed)}
                        leaderUnitSide={zone === 'leader' && c.deployed}
                        selected={sel?.uid === c.uid}
                        selectedUid={sel?.uid}
                        onClick={selectCard(zone, c.uid)}
                        onSelectUpgrade={(uid) => editor.select({ seat, zone, uid, parentUid: c.uid })}
                        draggable={false}
                        testId={`card-${seat}-${zone}`}
                    />
                ) : (
                    <Box sx={{ width: SLOT_CARD, aspectRatio: '1.4 / 1', borderRadius: '0.45rem', border: '1px dashed rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Typography sx={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', m: 0 }}>Choose {zone}</Typography>
                    </Box>
                )}
            </ZoneBox>
        );
    };

    const boardRow = (
        <Box sx={{ display: 'flex', gap: '8px', flex: '1.55 1 0', minHeight: 0 }}>
            {pile('space', ARENA_CARD, undefined, undefined, undefined, { flex: 1 })}
            <Box sx={{ display: 'flex', flexDirection: top ? 'column-reverse' : 'column', gap: '8px', width: `calc(${SLOT_CARD} + 20px)`, flex: '0 0 auto' }}>
                {slot('base')}
                {slot('leader')}
            </Box>
            {pile('ground', ARENA_CARD, undefined, undefined, undefined, { flex: 1.35 })}
        </Box>
    );

    const resourceCount = p.resources.length + p.fillerResources.ready + p.fillerResources.exhausted;
    const trayRow = (
        <Box sx={{ display: 'flex', gap: '8px', flex: '1 1 0', minHeight: 0 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: '2.2rem', flex: '0 0 auto' }}>
                <Typography sx={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontWeight: 800, letterSpacing: '0.18em', color: SEAT_COLOR[seat], fontSize: '0.85rem', m: 0 }}>
                    {seatLabel(seat)}{editor.position.initiative === seat ? ' · INITIATIVE' : ''}
                </Typography>
            </Box>
            {pile('hand', TRAY_CARD, undefined, undefined, undefined, { flex: 1.6 })}
            {pile('resources', TRAY_CARD, (
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Stepper label="ready" value={p.fillerResources.ready} onChange={(v) => editor.setPlayer(seat, { fillerResources: { ...p.fillerResources, ready: v } })} testId={`filler-ready-${seat}`} />
                    <Stepper label="exh." value={p.fillerResources.exhausted} onChange={(v) => editor.setPlayer(seat, { fillerResources: { ...p.fillerResources, exhausted: v } })} />
                </Box>
            ), resourceCount, undefined, { flex: 1.5 })}
            {pile('discard', TRAY_CARD, undefined, undefined, undefined, { flex: 0.8 })}
            {pile('deck', TRAY_CARD, (
                <Tooltip title="Filler cards under the named cards">
                    <Box><Stepper label="more" value={p.fillerDeck} onChange={(v) => editor.setPlayer(seat, { fillerDeck: v })} /></Box>
                </Tooltip>
            ), p.deck.length + p.fillerDeck, undefined, { flex: 1 })}
        </Box>
    );

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, minHeight: 0 }} data-testid={`editor-half-${seat}`}>
            {top ? trayRow : boardRow}
            {top ? boardRow : trayRow}
        </Box>
    );
};

export default PlayerHalf;
