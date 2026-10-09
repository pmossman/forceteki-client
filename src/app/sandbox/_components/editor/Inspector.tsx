'use client';
import React from 'react';
import { Box, Button, IconButton, MenuItem, Select, Switch, Typography } from '@mui/material';
import RemoveIcon from '@mui/icons-material/Remove';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { TokenContainer } from '@/app/_components/_sharedcomponents/_styledcomponents/TokenContainer';
import { useCardImageLocale } from '@/app/_contexts/CardImageLocale.context';
import { Seat, otherSeat, seatLabel } from '../../_engine/SandboxEngine';
import { CardIndex, cardImageUrl, cardKind, displayName } from '../../_lib/cardIndex';
import { PILE_ZONES, PileZone, ZONE_LABELS } from '../../_lib/position';
import { EditorApi, findCard } from '../../_lib/useEditor';
import { SEAT_COLOR, panelSx, pillButtonSx, sectionTitleSx } from '../sandboxTheme';

interface IInspectorProps {
    editor: EditorApi;
    index: CardIndex;
    onRequestSearch: () => void;
}

const Row: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({ label, children, hint }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '30px' }}>
        <Typography sx={{ fontSize: '0.8rem', m: 0, width: '6.4rem', color: 'rgba(255,255,255,0.75)' }}>{label}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>{children}</Box>
        {hint && <Typography sx={{ fontSize: '0.62rem', m: 0, color: 'rgba(255,255,255,0.35)' }}>{hint}</Typography>}
    </Box>
);

const Counter: React.FC<{ value: number; onChange: (v: number) => void; testId?: string; children?: React.ReactNode }> = ({ value, onChange, testId, children }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px' }} data-testid={testId}>
        <IconButton size="small" onClick={() => onChange(Math.max(0, value - 1))} sx={{ p: '2px', color: '#fff', background: 'rgba(255,255,255,0.08)' }} aria-label="decrease">
            <RemoveIcon sx={{ fontSize: '0.95rem' }} />
        </IconButton>
        <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, minWidth: '1.6rem', textAlign: 'center', m: 0 }}>{value}</Typography>
        <IconButton size="small" onClick={() => onChange(value + 1)} sx={{ p: '2px', color: '#fff', background: 'rgba(255,255,255,0.08)' }} aria-label="increase">
            <AddIcon sx={{ fontSize: '0.95rem' }} />
        </IconButton>
        {children}
    </Box>
);

const Inspector: React.FC<IInspectorProps> = ({ editor, index, onRequestSearch }) => {
    const locale = useCardImageLocale();
    const sel = editor.selection;
    const found = sel ? findCard(editor.position, sel.uid) : null;

    if (!sel || !found) {
        return (
            <Box sx={{ ...panelSx, p: '10px 12px' }} data-testid="inspector-empty">
                <Typography sx={sectionTitleSx}>Inspector</Typography>
                <Typography sx={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.55)', mt: '6px', mb: 0 }}>
                    Click a card on the board to set damage, exhaust it, add Shields, Experience or upgrades, or move it.
                    Keys: D / ⇧D damage · E exhaust · S shield · X experience · Del remove · ⌘Z undo.
                </Typography>
            </Box>
        );
    }

    const { card, zone, seat, parent } = found;
    const data = index.get(card.card);
    const kind = data ? cardKind(data) : 'other';
    const isUpgrade = !!parent;
    const inPlay = !isUpgrade && (zone === 'ground' || zone === 'space' || (zone === 'leader' && card.deployed));
    const upgrades = card.upgrades ?? [];
    const count = (name: string) => upgrades.filter((u) => u.card === name).length;
    const hpBonus = upgrades.reduce((sum, u) => sum + (index.get(u.card)?.upgradeHp ?? 0), 0);
    const powerBonus = upgrades.reduce((sum, u) => sum + (index.get(u.card)?.upgradePower ?? 0), 0);
    const maxHp = (data?.hp ?? 0) + hpBonus;
    const remaining = maxHp - (card.damage ?? 0);
    const owner: Seat = card.owner ?? seat;
    const img = data ? cardImageUrl(data, locale, { leaderSide: zone === 'leader' && !card.deployed }) : '';
    const landscape = (zone === 'leader' && !card.deployed) || zone === 'base';

    return (
        <Box sx={{ ...panelSx, p: '10px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }} data-testid="inspector">
            <Box sx={{ display: 'flex', gap: '10px', alignItems: 'flex-start', mb: '4px' }}>
                <Box sx={{ width: landscape ? 84 : 58, aspectRatio: landscape ? '1.4/1' : '1/1.4', borderRadius: '6px', backgroundImage: `url(${img})`, backgroundSize: 'cover', flex: '0 0 auto', backgroundColor: '#222' }} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontWeight: 800, fontSize: '0.95rem', m: 0, lineHeight: 1.2 }} data-testid="inspector-title">{data ? displayName(data) : card.card}</Typography>
                    <Typography sx={{ fontSize: '0.72rem', m: 0, color: 'rgba(255,255,255,0.6)' }}>
                        <Box component="span" sx={{ color: SEAT_COLOR[seat], fontWeight: 800 }}>{seatLabel(seat)}</Box>
                        {' · '}{isUpgrade ? `upgrade on ${index.get(parent!.card)?.title ?? parent!.card}` : ZONE_LABELS[zone]}
                        {inPlay && data?.power != null ? ` · ${data.power + powerBonus}/${maxHp}` : ''}
                    </Typography>
                    {data?.text && <Typography sx={{ fontSize: '0.68rem', m: '4px 0 0', color: 'rgba(255,255,255,0.55)', maxHeight: '3.2em', overflow: 'hidden' }}>{data.deployBox && zone === 'leader' ? data.deployBox : data.text}</Typography>}
                </Box>
                <IconButton aria-label="Remove card" onClick={() => editor.remove(card.uid)} sx={{ color: '#ff8080', p: '4px' }} data-testid="inspector-remove">
                    <DeleteOutlineIcon fontSize="small" />
                </IconButton>
            </Box>

            {zone === 'leader' && !isUpgrade && (
                <Row label="Deployed" hint="as a unit">
                    <Switch size="small" checked={!!card.deployed} onChange={(e) => editor.update(card.uid, { deployed: e.target.checked, ...(e.target.checked ? {} : { damage: 0, upgrades: undefined }) })} inputProps={{ 'aria-label': 'Deployed' }} data-testid="inspector-deployed" />
                </Row>
            )}
            {(inPlay || zone === 'base') && (
                <Row label="Damage" hint={maxHp ? `${remaining} HP left` : undefined}>
                    <Counter value={card.damage ?? 0} onChange={(v) => editor.update(card.uid, { damage: v })} testId="inspector-damage">
                        {zone === 'base' && (
                            <Button size="small" sx={{ ...pillButtonSx, ml: 1 }} onClick={() => editor.update(card.uid, { damage: (card.damage ?? 0) + 5 })}>+5</Button>
                        )}
                    </Counter>
                </Row>
            )}
            {(inPlay || zone === 'resources' || (zone === 'leader' && !isUpgrade)) && (
                <Row label="Exhausted" hint="E">
                    <Switch size="small" checked={!!card.exhausted} onChange={(e) => editor.update(card.uid, { exhausted: e.target.checked })} inputProps={{ 'aria-label': 'Exhausted' }} data-testid="inspector-exhausted" />
                </Row>
            )}
            {inPlay && (
                <>
                    <Row label="Shield" hint="S">
                        <Counter value={count('shield')} onChange={(v) => editor.bumpToken(card.uid, 'shield', v - count('shield'))} testId="inspector-shield">
                            <TokenContainer type="shield" sx={{ height: '1.3rem', px: '3px', '& svg': { width: '0.9rem', height: '0.9rem' } }} />
                        </Counter>
                    </Row>
                    <Row label="Experience" hint="X">
                        <Counter value={count('experience')} onChange={(v) => editor.bumpToken(card.uid, 'experience', v - count('experience'))} testId="inspector-experience">
                            <TokenContainer type="experience" sx={{ height: '1.3rem', px: '3px', '& svg': { width: '0.9rem', height: '0.9rem' } }} />
                        </Counter>
                    </Row>
                    <Row label="Upgrades">
                        <Button
                            size="small"
                            sx={pillButtonSx}
                            onClick={() => {
                                editor.setTarget({ seat, zone: 'upgrade', parentUid: card.uid });
                                onRequestSearch();
                            }}
                            data-testid="inspector-add-upgrade"
                        >
                            + Add upgrade…
                        </Button>
                    </Row>
                    {upgrades.filter((u) => u.card !== 'shield' && u.card !== 'experience').map((u) => (
                        <Box key={u.uid} sx={{ display: 'flex', alignItems: 'center', gap: '6px', pl: '6.9rem' }}>
                            <Typography
                                sx={{ fontSize: '0.78rem', m: 0, flex: 1, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                                onClick={() => editor.select({ seat, zone, uid: u.uid, parentUid: card.uid })}
                            >
                                {index.get(u.card)?.title ?? u.card}
                                {u.owner && u.owner !== seat ? <Box component="span" sx={{ color: SEAT_COLOR[u.owner], ml: '4px' }}>({seatLabel(u.owner)}&apos;s)</Box> : null}
                            </Typography>
                            <IconButton size="small" sx={{ p: '2px', color: '#ff8080' }} onClick={() => editor.remove(u.uid)} aria-label="Remove upgrade">
                                <DeleteOutlineIcon sx={{ fontSize: '0.95rem' }} />
                            </IconButton>
                        </Box>
                    ))}
                </>
            )}
            {(inPlay && zone !== 'leader') || isUpgrade ? (
                <Row label="Owner" hint={owner !== seat ? 'stolen' : undefined}>
                    {(['p1', 'p2'] as Seat[]).map((s) => (
                        <Button
                            key={s}
                            size="small"
                            sx={{ ...pillButtonSx, borderColor: owner === s ? SEAT_COLOR[s] : 'rgba(255,255,255,0.14)', color: owner === s ? SEAT_COLOR[s] : '#fff' }}
                            onClick={() => editor.update(card.uid, { owner: s === seat ? undefined : s })}
                        >
                            {seatLabel(s)}
                        </Button>
                    ))}
                </Row>
            ) : null}
            {isUpgrade && (
                <Button size="small" sx={{ ...pillButtonSx, alignSelf: 'flex-start' }} onClick={() => editor.select({ seat, zone, uid: parent!.uid })}>
                    ← Back to {index.get(parent!.card)?.title ?? 'unit'}
                </Button>
            )}
            {!isUpgrade && zone !== 'leader' && zone !== 'base' && (
                <Row label="Move to">
                    <Select
                        size="small"
                        variant="standard"
                        disableUnderline
                        value={`${seat}:${zone}`}
                        onChange={(e) => {
                            const [s, z] = (e.target.value as string).split(':');
                            editor.move(card.uid, s as Seat, z as PileZone);
                            editor.select({ seat: s as Seat, zone: z as PileZone, uid: card.uid });
                        }}
                        sx={{ color: '#fff', fontSize: '0.82rem', '& .MuiSelect-icon': { color: '#fff' } }}
                        data-testid="inspector-move"
                    >
                        {[seat, otherSeat(seat)].flatMap((s) => PILE_ZONES.map((z) => (
                            <MenuItem key={`${s}:${z}`} value={`${s}:${z}`}>{seatLabel(s)} · {ZONE_LABELS[z]}</MenuItem>
                        )))}
                    </Select>
                    {(zone === 'deck' || zone === 'hand' || zone === 'resources' || zone === 'discard') && (
                        <>
                            <IconButton size="small" sx={{ p: '2px', color: '#fff' }} onClick={() => editor.reorder(seat, zone, card.uid, -1)} aria-label="Move earlier"><ArrowUpwardIcon sx={{ fontSize: '0.95rem' }} /></IconButton>
                            <IconButton size="small" sx={{ p: '2px', color: '#fff' }} onClick={() => editor.reorder(seat, zone, card.uid, 1)} aria-label="Move later"><ArrowDownwardIcon sx={{ fontSize: '0.95rem' }} /></IconButton>
                        </>
                    )}
                </Row>
            )}
            {kind === 'leader' && zone === 'leader' && card.deployed && !data?.deployBox && (
                <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.5)', m: 0 }}>Deployed leaders sit in the arena as units.</Typography>
            )}
        </Box>
    );
};

export default Inspector;
