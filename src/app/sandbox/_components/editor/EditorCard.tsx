'use client';
import React from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import { TokenContainer } from '@/app/_components/_sharedcomponents/_styledcomponents/TokenContainer';
import { useCardImageLocale } from '@/app/_contexts/CardImageLocale.context';
import { CardIndex, cardImageUrl, displayName } from '../../_lib/cardIndex';
import { IPosCard } from '../../_lib/position';
import { SEAT_COLOR } from '../sandboxTheme';
import { Seat } from '../../_engine/SandboxEngine';

const TOKEN_NAMES = ['shield', 'experience', 'advantage', 'weakness'] as const;

interface IEditorCardProps {
    card: IPosCard;
    index: CardIndex;
    seat: Seat;
    width: string;
    selected?: boolean;

    /** horizontal leader/base art */
    landscape?: boolean;

    /** show the leader's unit side */
    leaderUnitSide?: boolean;
    showTokens?: boolean;
    onClick?: (e: React.MouseEvent) => void;
    onSelectUpgrade?: (upgradeUid: string) => void;
    selectedUid?: string | null;
    draggable?: boolean;
    testId?: string;
}

const EditorCard: React.FC<IEditorCardProps> = ({
    card, index, seat, width, selected, landscape, leaderUnitSide, showTokens = true, onClick, onSelectUpgrade, selectedUid, draggable = true, testId,
}) => {
    const locale = useCardImageLocale();
    const data = index.get(card.card);
    const upgrades = card.upgrades ?? [];
    const tokenCounts = TOKEN_NAMES.map((t) => ({ t, n: upgrades.filter((u) => u.card === t).length })).filter((x) => x.n > 0);
    const otherUpgrades = upgrades.filter((u) => !(TOKEN_NAMES as readonly string[]).includes(u.card));
    const img = data ? cardImageUrl(data, locale, { leaderSide: landscape && !leaderUnitSide }) : '';
    const name = data ? displayName(data) : card.card;
    const stolen = !!card.owner && card.owner !== seat;

    const styles = {
        wrap: {
            width,
            flex: '0 0 auto',
            display: 'flex',
            flexDirection: 'column' as const,
            gap: '2px',
            cursor: 'pointer',
            userSelect: 'none' as const,
        },
        card: {
            position: 'relative' as const,
            width: '100%',
            aspectRatio: landscape ? '1.4 / 1' : '1 / 1.4',
            borderRadius: '0.45rem',
            backgroundColor: '#111',
            backgroundImage: img ? `url(${img})` : 'none',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            outline: selected ? '3px solid var(--selection-blue)' : '1px solid rgba(255,255,255,0.15)',
            outlineOffset: selected ? '1px' : 0,
            transform: card.exhausted ? 'rotate(5deg)' : 'none',
            filter: card.exhausted ? 'brightness(0.62)' : 'none',
            transition: 'transform 0.15s ease, filter 0.15s ease, outline-color 0.15s',
            boxShadow: '0 2px 6px rgba(0,0,0,0.6)',
            '&:hover': { outlineColor: selected ? 'var(--selection-blue)' : SEAT_COLOR[seat] },
        },
        missing: {
            position: 'absolute' as const,
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center' as const,
            fontSize: '0.65rem',
            p: '4px',
            color: '#ff8a8a',
        },
        damage: {
            position: 'absolute' as const,
            top: '6%',
            right: '-6%',
            transform: 'scale(0.62)',
            transformOrigin: 'top right',
        },
        tokens: {
            position: 'absolute' as const,
            bottom: '4%',
            left: '4%',
            display: 'flex',
            gap: '2px',
            flexWrap: 'wrap' as const,
        },
        exhaustedTag: {
            position: 'absolute' as const,
            top: '38%',
            left: 0,
            right: 0,
            textAlign: 'center' as const,
            fontSize: '0.6rem',
            fontWeight: 800,
            letterSpacing: '0.12em',
            color: '#fff',
            textShadow: '0 0 4px #000, 0 0 2px #000',
            pointerEvents: 'none' as const,
        },
        upgradeChip: (isSel: boolean) => ({
            fontSize: '0.62rem',
            lineHeight: 1.25,
            px: '4px',
            py: '1px',
            borderRadius: '4px',
            background: isSel ? 'rgba(102,229,255,0.35)' : 'rgba(255,255,255,0.12)',
            border: isSel ? '1px solid var(--selection-blue)' : '1px solid transparent',
            whiteSpace: 'nowrap' as const,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            '&:hover': { background: 'rgba(255,255,255,0.22)' },
        }),
        flag: {
            position: 'absolute' as const,
            top: '3%',
            left: '3%',
            fontSize: '0.55rem',
            fontWeight: 800,
            px: '3px',
            borderRadius: '3px',
            background: 'rgba(0,0,0,0.75)',
        },
    };

    return (
        <Box
            sx={styles.wrap}
            onClick={onClick}
            draggable={draggable}
            onDragStart={(e) => {
                e.dataTransfer.setData('application/x-sandbox-uid', card.uid);
                e.dataTransfer.effectAllowed = 'move';
            }}
            data-testid={testId}
            data-card={card.card}
        >
            <Tooltip
                title={<Box sx={{ width: landscape ? 280 : 200, aspectRatio: landscape ? '1.4/1' : '1/1.4', backgroundImage: img ? `url(${img})` : 'none', backgroundSize: 'cover', borderRadius: '8px' }} />}
                placement="right"
                enterDelay={450}
                enterNextDelay={300}
                slotProps={{ tooltip: { sx: { background: 'transparent', p: 0, maxWidth: 'none' } } }}
            >
                <Box sx={styles.card} aria-label={name}>
                    {!data && <Box sx={styles.missing}>Unknown card<br />{card.card}</Box>}
                    {stolen && <Box sx={{ ...styles.flag, color: SEAT_COLOR[card.owner!] }}>STOLEN</Box>}
                    {card.deployed && landscape && <Box sx={{ ...styles.flag, color: '#FFFE50' }}>DEPLOYED</Box>}
                    {!!card.damage && (
                        <Box sx={styles.damage}>
                            <TokenContainer type="damageCounter" sx={{ px: '.6rem', py: '.25rem', fontSize: '1.6rem', fontWeight: 700 }}>
                                {card.damage}
                            </TokenContainer>
                        </Box>
                    )}
                    {showTokens && tokenCounts.length > 0 && (
                        <Box sx={styles.tokens}>
                            {tokenCounts.map(({ t, n }) => (
                                <TokenContainer key={t} type={t} sx={{ height: '1.15rem', px: '3px', gap: '2px', fontSize: '0.7rem', fontWeight: 700, '& svg': { width: '0.8rem', height: '0.8rem' } }}>
                                    {n > 1 ? n : null}
                                </TokenContainer>
                            ))}
                        </Box>
                    )}
                    {card.exhausted && <Typography sx={styles.exhaustedTag}>EXHAUSTED</Typography>}
                </Box>
            </Tooltip>
            {otherUpgrades.map((u) => {
                const ud = index.get(u.card);
                return (
                    <Box
                        key={u.uid}
                        sx={styles.upgradeChip(selectedUid === u.uid)}
                        title={ud ? displayName(ud) : u.card}
                        onClick={(e) => {
                            e.stopPropagation();
                            onSelectUpgrade?.(u.uid);
                        }}
                    >
                        + {ud ? ud.title : u.card}
                    </Box>
                );
            })}
        </Box>
    );
};

export default EditorCard;
