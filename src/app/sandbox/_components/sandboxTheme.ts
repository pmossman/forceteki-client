import { Seat } from '../_engine/SandboxEngine';

/** Seat colours follow the game board: the bottom player's blue aura, the opponent's red. */
export const SEAT_COLOR: Record<Seat, string> = {
    p1: '#00BAFF',
    p2: '#FF3231',
};

export const SEAT_TINT: Record<Seat, string> = {
    p1: 'rgba(0, 186, 255, 0.14)',
    p2: 'rgba(255, 50, 49, 0.14)',
};

export const panelSx = {
    background: 'rgba(0, 0, 0, 0.72)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: '10px',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
};

export const sectionTitleSx = {
    fontSize: '0.72rem',
    fontWeight: 700,
    letterSpacing: '0.09em',
    textTransform: 'uppercase' as const,
    color: 'rgba(255, 255, 255, 0.62)',
    m: 0,
};

export const pillButtonSx = {
    color: '#fff',
    background: 'rgba(255, 255, 255, 0.08)',
    border: '1px solid rgba(255, 255, 255, 0.14)',
    borderRadius: '999px',
    textTransform: 'none' as const,
    fontWeight: 600,
    px: 1.5,
    py: 0.25,
    minWidth: 0,
    lineHeight: 1.6,
    '&:hover': { background: 'rgba(255, 255, 255, 0.16)' },
    '&.Mui-disabled': { color: 'rgba(255,255,255,0.35)' },
};

export const primaryButtonSx = {
    color: '#fff',
    fontWeight: 700,
    textTransform: 'none' as const,
    borderRadius: '12px',
    border: '2px solid transparent',
    background: 'linear-gradient(#1E2D32, #1E2D32) padding-box, linear-gradient(to top, #038FC3, #595A5B) border-box',
    px: 2,
    '&:hover': { filter: 'brightness(1.25)' },
    '&.Mui-disabled': { color: '#777' },
};
