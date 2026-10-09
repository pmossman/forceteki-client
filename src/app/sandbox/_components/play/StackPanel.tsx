'use client';
import React, { useState } from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import { useCardImageLocale } from '@/app/_contexts/CardImageLocale.context';
import { useGameOptional } from '@/app/_contexts/Game.context';
import { s3CardImageURL } from '@/app/_utils/s3Utils';
import { ICardRef, ISandboxSnapshot, IStackFrame, IStackItem, Seat, seatLabel } from '../../_engine/SandboxEngine';
import { CardIndex, cardImageUrl } from '../../_lib/cardIndex';
import { SEAT_COLOR, panelSx, sectionTitleSx } from '../sandboxTheme';

interface IStackPanelProps {
    snapshot: ISandboxSnapshot;
    index: CardIndex | null;
    acting: Seat | null;
    canAct: boolean;
    onChooseItem: (seat: Seat, command: string, arg: string) => void;
}

const thumbUrl = (ref: ICardRef | undefined, index: CardIndex | null, locale: ReturnType<typeof useCardImageLocale>) => {
    if (!ref) {
        return '';
    }
    const card = index?.get(ref.internalName);
    if (card) {
        return cardImageUrl(card, locale, { leaderSide: false });
    }
    if (ref.setId?.number != null) {
        return s3CardImageURL({ setId: { set: ref.setId.set, number: ref.setId.number }, type: 'unit', id: '' }, locale);
    }
    return '';
};

const STATUS_ICON: Record<string, string> = { resolving: '▶', pending: '⏸', resolved: '✓' };

/** The resolution stack in plain rules wording, top ("now") to bottom (the player's action). DESIGN §4.3. */
const StackPanel: React.FC<IStackPanelProps> = ({ snapshot, index, acting, canAct, onChooseItem }) => {
    const locale = useCardImageLocale();
    const game = useGameOptional();
    const [openHints, setOpenHints] = useState<Record<string, boolean>>({});
    const frames = snapshot.stack ?? [];
    const layerCount = frames.filter((f) => f.kind !== 'action').length;

    const hover = (uuid?: string) => {
        if (uuid) {
            game?.hoveredChatCard.hover(uuid);
        }
    };
    const unhover = () => game?.hoveredChatCard.clear();

    const buttonFor = (frame: IStackFrame, item: IStackItem) => {
        if (!frame.chooser || !canAct || frame.chooser.seat !== acting || item.status !== 'pending') {
            return null;
        }
        const buttons = snapshot.prompts?.[frame.chooser.seat]?.buttons ?? [];
        const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
        return buttons.find((b) => norm(b.text) === norm(item.engineTitle)) ??
            buttons.find((b) => norm(b.text).includes(norm(item.engineTitle)) || norm(item.engineTitle).includes(norm(b.text))) ?? null;
    };

    const renderItem = (frame: IStackFrame, item: IStackItem) => {
        const button = buttonFor(frame, item);
        const dim = !item.hasLegalEffects && item.status !== 'resolved';
        return (
            <Tooltip
                key={item.id}
                placement="left"
                enterDelay={350}
                title={
                    <Box sx={{ fontSize: '0.75rem' }}>
                        <div><b>Engine:</b> {item.engineTitle}</div>
                        <div>{item.label} · {seatLabel(item.controller)} · {item.status}{item.optional ? ' · optional' : ''}{item.hasLegalEffects ? '' : ' · no legal effect'}</div>
                        {frame.engine?.detail && <div style={{ opacity: 0.7, marginTop: 4 }}>{frame.engine.step}: {frame.engine.detail}</div>}
                        {button && <div style={{ marginTop: 4, color: '#66E5FF' }}>Click to resolve this first</div>}
                    </Box>
                }
            >
                <Box
                    data-testid={`stack-item-${item.status}`}
                    data-item-label={item.label}
                    onMouseEnter={() => hover(item.sourceCard?.uuid)}
                    onMouseLeave={unhover}
                    onClick={() => button && frame.chooser && onChooseItem(frame.chooser.seat, button.command, button.arg)}
                    sx={{
                        display: 'flex',
                        gap: '8px',
                        alignItems: 'flex-start',
                        p: '5px 6px',
                        borderRadius: '6px',
                        opacity: dim ? 0.55 : item.status === 'resolved' ? 0.7 : 1,
                        background: item.status === 'resolving' ? 'rgba(102,229,255,0.12)' : 'transparent',
                        border: button ? '1px dashed rgba(102,229,255,0.6)' : '1px solid transparent',
                        cursor: button ? 'pointer' : 'default',
                        '&:hover': { background: button ? 'rgba(102,229,255,0.18)' : 'rgba(255,255,255,0.05)' },
                    }}
                >
                    <Typography sx={{ fontSize: '0.8rem', m: 0, width: '0.9rem', color: item.status === 'resolving' ? 'var(--selection-blue)' : 'rgba(255,255,255,0.6)' }}>
                        {STATUS_ICON[item.status] ?? '·'}
                    </Typography>
                    <Box sx={{ width: 30, height: 42, flex: '0 0 auto', borderRadius: '3px', backgroundImage: `url(${thumbUrl(item.sourceCard, index, locale)})`, backgroundSize: 'cover', backgroundColor: '#222', border: `1px solid ${SEAT_COLOR[item.controller] ?? '#555'}` }} />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Box sx={{ display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, m: 0, color: SEAT_COLOR[item.controller] }}>
                                {item.label}
                            </Typography>
                            <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, m: 0 }}>({item.sourceCard?.name ?? '?'})</Typography>
                            {item.count && item.count > 1 && <Badge text={`×${item.count}`} />}
                            {item.optional && <Badge text="you may" />}
                            {item.fromHiddenZone && <Badge text="shown to opponent" color="#ffd166" />}
                            {dim && <Badge text="no effect right now" color="#ff9b9b" />}
                        </Box>
                        <Typography sx={{ fontSize: '0.72rem', m: 0, color: 'rgba(255,255,255,0.75)', lineHeight: 1.3 }}>{item.title}</Typography>
                    </Box>
                </Box>
            </Tooltip>
        );
    };

    const renderFrame = (frame: IStackFrame, i: number) => {
        const isTop = i === 0;
        if (frame.kind === 'action') {
            return (
                <Tooltip key={frame.id} placement="left" title={frame.engine ? `${frame.engine.step}: ${frame.engine.detail}` : ''}>
                    <Box
                        data-testid="stack-frame-action"
                        onMouseEnter={() => hover(frame.sourceCard?.uuid)}
                        onMouseLeave={unhover}
                        sx={{ display: 'flex', gap: '8px', alignItems: 'center', p: '6px 8px', borderTop: '1px solid rgba(255,255,255,0.12)' }}
                    >
                        <Typography sx={{ fontSize: '0.78rem', m: 0, color: frame.controller ? SEAT_COLOR[frame.controller] : '#fff', fontWeight: 700 }}>
                            {frame.status === 'resolving' ? '▶' : '─'} {frame.title}
                        </Typography>
                        {frame.status !== 'resolving' && <Typography sx={{ fontSize: '0.7rem', m: 0, color: 'rgba(255,255,255,0.5)' }}>{frame.status === 'waiting' ? 'waiting for its triggers' : frame.status}</Typography>}
                    </Box>
                </Tooltip>
            );
        }
        const borderColor = frame.status === 'resolving' || isTop ? 'rgba(102,229,255,0.65)' : 'rgba(255,255,255,0.14)';
        return (
            <Box
                key={frame.id}
                data-testid={`stack-frame-${frame.kind}`}
                data-depth={frame.depth}
                sx={{ border: `1px solid ${borderColor}`, borderRadius: '8px', p: '6px 8px', background: isTop ? 'rgba(102,229,255,0.06)' : 'rgba(255,255,255,0.03)', ml: `${Math.min(frame.depth, 4) * 0}px` }}
            >
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap' }}>
                    {isTop && <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, m: 0, color: 'var(--selection-blue)', letterSpacing: '0.08em' }}>NOW</Typography>}
                    <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, m: 0 }} data-testid="stack-frame-title">{frame.title}</Typography>
                    {frame.status === 'waiting' && <Badge text="waiting" color="#ffd166" />}
                </Box>
                {frame.triggeredBy && frame.triggeredBy.length > 0 && (
                    <Typography sx={{ fontSize: '0.7rem', m: 0, color: 'rgba(255,255,255,0.6)' }}>Triggered when {frame.triggeredBy.join('; ')}</Typography>
                )}
                {frame.nestedUnder && (
                    <Typography sx={{ fontSize: '0.7rem', m: 0, color: '#c9a8ff' }} data-testid="stack-nested-under">↳ nested: triggered while resolving {frame.nestedUnder.title}</Typography>
                )}
                {frame.chooser && (
                    <Typography sx={{ fontSize: '0.74rem', m: '2px 0 0', fontWeight: 700, color: SEAT_COLOR[frame.chooser.seat] }} data-testid="stack-chooser">
                        {frame.chooser.text}
                    </Typography>
                )}
                {frame.waitingReason && <Typography sx={{ fontSize: '0.7rem', m: 0, color: '#ffd166' }}>{frame.waitingReason}</Typography>}
                {frame.kind === 'ability' && frame.sourceCard && (
                    <Typography sx={{ fontSize: '0.7rem', m: 0, color: 'rgba(255,255,255,0.6)' }} onMouseEnter={() => hover(frame.sourceCard?.uuid)} onMouseLeave={unhover}>
                        Source: {frame.sourceCard.name}{frame.controller ? ` (${seatLabel(frame.controller)})` : ''}
                    </Typography>
                )}
                {frame.items && frame.items.length > 0 && <Box sx={{ mt: '4px', display: 'flex', flexDirection: 'column', gap: '2px' }}>{frame.items.map((it) => renderItem(frame, it))}</Box>}
                {frame.rulesHint && (
                    <Box sx={{ mt: '3px' }}>
                        <Typography
                            sx={{ fontSize: '0.68rem', m: 0, color: 'rgba(102,229,255,0.85)', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                            onClick={() => setOpenHints((h) => ({ ...h, [frame.id]: !h[frame.id] }))}
                        >
                            {openHints[frame.id] ? '▾' : '▸'} why?
                        </Typography>
                        {openHints[frame.id] && (
                            <Typography sx={{ fontSize: '0.7rem', m: 0, color: 'rgba(255,255,255,0.7)' }}>
                                {frame.rulesHint.text}{frame.rulesHint.refs?.length ? ` (CR ${frame.rulesHint.refs.join(', ')})` : ''}
                            </Typography>
                        )}
                    </Box>
                )}
            </Box>
        );
    };

    return (
        <Box sx={{ ...panelSx, p: '10px', display: 'flex', flexDirection: 'column', gap: '6px', minHeight: 0, maxHeight: '52%', flex: '0 1 auto' }} data-testid="stack-panel">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Typography sx={sectionTitleSx} data-testid="stack-count">Resolving ({layerCount})</Typography>
                <Box sx={{ flex: 1 }} />
                {acting && <Typography sx={{ fontSize: '0.72rem', m: 0, fontWeight: 800, color: SEAT_COLOR[acting] }}>{seatLabel(acting)} decides</Typography>}
            </Box>
            <Box sx={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', minHeight: 0 }}>
                {frames.length === 0 ? (
                    <Typography sx={{ fontSize: '0.78rem', m: 0, color: 'rgba(255,255,255,0.5)' }}>
                        Nothing is resolving. Pending triggers, their order and nesting show up here.
                    </Typography>
                ) : frames.map(renderFrame)}
            </Box>
            <Typography sx={{ fontSize: '0.62rem', m: 0, color: 'rgba(255,255,255,0.35)' }}>Engine behaviour, which can differ from the CR (e.g. Plot&apos;s reveal step, CR 7.5.19.b). Hover for engine detail.</Typography>
        </Box>
    );
};

const Badge: React.FC<{ text: string; color?: string }> = ({ text, color = 'rgba(255,255,255,0.75)' }) => (
    <Box component="span" sx={{ fontSize: '0.62rem', fontWeight: 700, px: '5px', borderRadius: '999px', border: `1px solid ${color}`, color, lineHeight: 1.5, whiteSpace: 'nowrap' }}>
        {text}
    </Box>
);

export default StackPanel;
