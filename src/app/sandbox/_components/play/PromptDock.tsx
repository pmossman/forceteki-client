'use client';
import React, { useEffect, useRef, useState } from 'react';
import { Box, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import RichText from '@/app/_components/_sharedcomponents/RichText/RichText';
import { ISandboxSnapshot, Seat, seatLabel } from '../../_engine/SandboxEngine';
import { SEAT_COLOR, SEAT_TINT } from '../sandboxTheme';
import { ViewMode } from './SandboxGameBridge';

interface IPromptDockProps {
    snapshot: ISandboxSnapshot;
    acting: Seat | null;
    replaying: boolean;
    viewMode: ViewMode;
    onFocusDecider: (s: Seat) => void;
}

/** Always names who decides, in that seat's colour (DESIGN §4.1). */
const PromptDock: React.FC<IPromptDockProps> = ({ snapshot, acting, replaying, viewMode, onFocusDecider }) => {
    const deciders = snapshot.deciders ?? [];
    const prompt = acting ? snapshot.prompts?.[acting] : null;
    const prevActing = useRef<Seat | null>(acting);
    const [handOff, setHandOff] = useState<string | null>(null);

    useEffect(() => {
        if (acting && prevActing.current && acting !== prevActing.current) {
            setHandOff(`Hand-off: now ${seatLabel(acting)} decides`);
            const t = window.setTimeout(() => setHandOff(null), 2600);
            prevActing.current = acting;
            return () => window.clearTimeout(t);
        }
        prevActing.current = acting;
    }, [acting]);

    const hiddenDecider = viewMode !== 'both' && acting === null && deciders.length > 0 ? deciders[0] : null;
    const color = acting ? SEAT_COLOR[acting] : 'rgba(255,255,255,0.4)';
    const title = snapshot.gameOver
        ? `Game over: ${snapshot.gameOver.winners.join(', ') || 'draw'}`
        : acting ? `${seatLabel(acting)} decides` : hiddenDecider ? `${seatLabel(hiddenDecider)} decides (hidden in this view)` : 'Nothing to decide';

    return (
        <Box
            data-testid="prompt-dock"
            data-acting={acting ?? ''}
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                px: '12px',
                py: '6px',
                minHeight: '46px',
                background: acting ? `linear-gradient(90deg, ${SEAT_TINT[acting]}, rgba(0,0,0,0.75) 55%)` : 'rgba(0,0,0,0.75)',
                borderBottom: `2px solid ${color}`,
                transition: 'background 0.3s, border-color 0.3s',
                position: 'relative',
                zIndex: 5,
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '0 0 auto' }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', background: color, boxShadow: acting ? `0 0 10px ${color}` : 'none' }} />
                <Typography sx={{ fontWeight: 800, fontSize: '1rem', m: 0, color, textTransform: 'uppercase', letterSpacing: '0.06em' }} data-testid="prompt-dock-decider">
                    {title}
                </Typography>
                {deciders.length > 1 && (
                    <ToggleButtonGroup size="small" exclusive value={acting} onChange={(_, v) => v && onFocusDecider(v)}>
                        {deciders.map((s) => (
                            <ToggleButton key={s} value={s} sx={{ py: 0, px: 1, color: SEAT_COLOR[s], borderColor: 'rgba(255,255,255,0.2)', '&.Mui-selected': { background: SEAT_COLOR[s], color: '#000' } }}>
                                {seatLabel(s)}
                            </ToggleButton>
                        ))}
                    </ToggleButtonGroup>
                )}
            </Box>
            <Box sx={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
                {prompt?.menuTitle ? (
                    <Box sx={{ fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} data-testid="prompt-dock-text">
                        <RichText text={prompt.menuTitle} />
                    </Box>
                ) : null}
                {prompt?.promptTitle && prompt.promptTitle !== prompt.menuTitle && (
                    <Typography sx={{ fontSize: '0.7rem', m: 0, color: 'rgba(255,255,255,0.55)' }}>{prompt.promptTitle}</Typography>
                )}
            </Box>
            {replaying && <Typography sx={{ fontSize: '0.75rem', m: 0, color: 'var(--selection-yellow)' }}>replaying…</Typography>}
            {handOff && (
                <Typography sx={{ fontSize: '0.8rem', m: 0, fontWeight: 700, color, animation: 'sbPulse 1.2s ease-in-out 2', '@keyframes sbPulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.35 } } }} data-testid="prompt-dock-handoff">
                    {handOff}
                </Typography>
            )}
        </Box>
    );
};

export default PromptDock;
