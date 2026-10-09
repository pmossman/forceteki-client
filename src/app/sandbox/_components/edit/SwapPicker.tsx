'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, InputBase, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useCardImageLocale } from '@/app/_contexts/CardImageLocale.context';
import { CardIndex, CardKind, ISandboxCard, cardImageUrl, cardKind, nameKey, setCodeLabel } from '../../_lib/cardIndex';
import { panelSx } from '../sandboxTheme';

interface ISwapPickerProps {
    index: CardIndex;

    /** title of the card being replaced (other versions of it are offered first) */
    currentName: string;
    kinds: CardKind[];
    arena?: 'ground' | 'space';
    onPick: (card: ISandboxCard) => void;
    onMore: () => void;
    onClose: () => void;
}

/** Swap a card in place: search is focused at once, typing filters live, Enter or a click picks, Escape closes. */
const SwapPicker: React.FC<ISwapPickerProps> = ({ index, currentName, kinds, arena, onPick, onMore, onClose }) => {
    const locale = useCardImageLocale();
    const [query, setQuery] = useState('');
    const [highlight, setHighlight] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const results = useMemo(() => {
        if (query.trim()) {
            return index.search(query, { kinds, arena, limit: 30 });
        }
        // nothing typed yet: other versions of the same card
        const key = nameKey(currentName);
        return index.all.filter((c) => nameKey(c.title) === key && kinds.includes(cardKind(c)) && (!arena || !c.arena || c.arena === arena)).slice(0, 12);
    }, [index, query, kinds, arena, currentName]);

    useEffect(() => setHighlight(0), [query]);

    return (
        <Box sx={{ ...panelSx, width: 330, p: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }} data-testid="swap-picker">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', px: '8px', py: '3px', borderRadius: '8px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(102,229,255,0.45)' }}>
                <SearchIcon sx={{ fontSize: '1.05rem', opacity: 0.7 }} />
                <InputBase
                    inputRef={inputRef}
                    autoFocus
                    placeholder={`Swap ${currentName || 'card'} for…`}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setHighlight((h) => Math.min(results.length - 1, h + 1));
                        } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setHighlight((h) => Math.max(0, h - 1));
                        } else if (e.key === 'Enter' && results[highlight]) {
                            e.preventDefault();
                            onPick(results[highlight]);
                        } else if (e.key === 'Escape') {
                            onClose();
                        }
                    }}
                    sx={{ color: '#fff', flex: 1, fontSize: '0.92rem' }}
                    inputProps={{ 'data-testid': 'swap-input', 'aria-label': 'Swap card search' }}
                />
            </Box>
            <Box sx={{ maxHeight: 300, overflowY: 'auto' }}>
                {results.length === 0 && (
                    <Typography sx={{ fontSize: '0.78rem', m: 0, p: '6px', color: 'rgba(255,255,255,0.5)' }}>{query ? 'No matching cards.' : 'Type a card name.'}</Typography>
                )}
                {results.map((card, i) => {
                    const landscape = cardKind(card) === 'leader' || cardKind(card) === 'base';
                    return (
                        <Box
                            key={card.internalName}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => onPick(card)}
                            onMouseEnter={() => setHighlight(i)}
                            data-testid={`swap-result-${card.internalName}`}
                            sx={{ display: 'flex', gap: '8px', alignItems: 'center', p: '3px 6px', borderRadius: '6px', cursor: 'pointer', background: i === highlight ? 'rgba(102,229,255,0.18)' : 'transparent' }}
                        >
                            <Box sx={{ width: landscape ? 40 : 28, height: landscape ? 29 : 39, flex: '0 0 auto', borderRadius: '3px', backgroundImage: `url(${cardImageUrl(card, locale)})`, backgroundSize: 'cover', backgroundColor: '#222' }} />
                            <Box sx={{ minWidth: 0 }}>
                                <Typography sx={{ fontSize: '0.84rem', fontWeight: 700, m: 0, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.title}</Typography>
                                <Typography sx={{ fontSize: '0.68rem', m: 0, color: 'rgba(255,255,255,0.55)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {card.subtitle ? `${card.subtitle} · ` : ''}{setCodeLabel(card)}{card.power != null && card.hp != null ? ` · ${card.power}/${card.hp}` : ''}
                                </Typography>
                            </Box>
                        </Box>
                    );
                })}
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography sx={{ fontSize: '0.64rem', m: 0, color: 'rgba(255,255,255,0.4)' }}>↑↓ choose · Enter swap · Esc close</Typography>
                <Typography onClick={onMore} sx={{ fontSize: '0.7rem', m: 0, color: 'var(--selection-blue)', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }} data-testid="swap-more">
                    more…
                </Typography>
            </Box>
        </Box>
    );
};

export default SwapPicker;
