'use client';
import React, { useState } from 'react';
import { Box, Button, InputBase, MenuItem, Select, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LinkIcon from '@mui/icons-material/Link';
import EditIcon from '@mui/icons-material/Edit';
import FirstPageIcon from '@mui/icons-material/FirstPage';
import ViewSidebarIcon from '@mui/icons-material/ViewSidebar';
import { EngineStatus, Seat, seatLabel } from '../_engine/SandboxEngine';
import { Orientation, ViewMode } from './play/SandboxGameBridge';
import { StageMode } from './SandboxStage';
import { SEAT_COLOR, pillButtonSx } from './sandboxTheme';

interface ITopBarProps {
    mode: StageMode;
    onMode: (m: StageMode) => void;
    title: string;
    onTitleChange: (title: string) => void;
    viewMode: ViewMode;
    onViewMode: (v: ViewMode) => void;
    orientation: Orientation;
    onOrientation: (o: Orientation) => void;
    onResetToStart: () => void;
    onEditFromHere: () => void;
    onCopyText: () => void;
    onCopyLink: () => void;
    engineStatus: EngineStatus;
    engineDetail?: string;
    engineKind: string;
    panelOpen: boolean;
    onTogglePanel: () => void;
    toast: string | null;
}

const STATUS_COLOR: Record<EngineStatus, string> = { ready: '#4cd964', connecting: '#ffd166', disconnected: '#ff8a8a', error: '#ff5c5c' };
const STATUS_TEXT: Record<EngineStatus, string> = { ready: 'Engine ready', connecting: 'Starting the engine…', disconnected: 'Engine disconnected', error: 'Engine unavailable' };

const TitleField: React.FC<{ title: string; onChange: (t: string) => void; editable: boolean }> = ({ title, onChange, editable }) => {
    const [draft, setDraft] = useState<string | null>(null);
    if (!editable) {
        return <Typography sx={{ fontSize: '0.88rem', m: 0, px: 1, color: 'rgba(255,255,255,0.8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title || 'Untitled position'}</Typography>;
    }
    return (
        <InputBase
            value={draft ?? title}
            placeholder="Untitled position"
            onFocus={() => setDraft(title)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
                if (draft !== null && draft !== title) {
                    onChange(draft.trim());
                }
                setDraft(null);
            }}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                    (e.target as HTMLInputElement).blur();
                }
            }}
            inputProps={{ 'data-testid': 'position-title-input', 'aria-label': 'Position title' }}
            sx={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.88rem', flex: 1, minWidth: 0, px: 1, borderRadius: '6px', '&:hover': { background: 'rgba(255,255,255,0.06)' }, '&.Mui-focused': { background: 'rgba(255,255,255,0.1)' } }}
        />
    );
};

/** Karabast-styled top bar: Edit/Play, whose view, back to start, sharing and the engine indicator. */
const TopBar: React.FC<ITopBarProps> = (props) => {
    const { mode } = props;
    const modeButton = (m: StageMode, label: string) => (
        <Button
            onClick={() => props.onMode(m)}
            data-testid={`mode-${m}`}
            sx={{
                color: mode === m ? '#000' : '#fff',
                background: mode === m ? (m === 'edit' ? 'var(--selection-yellow)' : 'var(--initiative-blue)') : 'transparent',
                fontWeight: 800,
                letterSpacing: '0.08em',
                borderRadius: '999px',
                px: 2,
                py: 0.2,
                minWidth: 0,
                '&:hover': { background: mode === m ? (m === 'edit' ? 'var(--selection-yellow)' : 'var(--initiative-blue)') : 'rgba(255,255,255,0.1)' },
            }}
        >
            {label}
        </Button>
    );

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', px: '12px', height: '48px', flex: '0 0 auto', background: 'rgba(0,0,0,0.88)', borderBottom: '1px solid rgba(255,255,255,0.12)', position: 'relative', zIndex: 20 }}>
            <Box component="img" src="/karabastTiny.png" alt="" sx={{ height: 26 }} />
            <Typography sx={{ fontWeight: 800, letterSpacing: '0.12em', fontSize: '0.92rem', m: 0, whiteSpace: 'nowrap' }}>
                KARABAST <Box component="span" sx={{ color: 'var(--initiative-blue)' }}>SANDBOX</Box>
            </Typography>
            <Box sx={{ display: 'flex', gap: '4px', p: '3px', borderRadius: '999px', border: '1px solid rgba(255,255,255,0.15)' }}>
                {modeButton('edit', 'EDIT')}
                {modeButton('play', 'PLAY')}
            </Box>
            {mode === 'play' && (
                <>
                    <Tooltip title="Whose hidden information is visible">
                        <ToggleButtonGroup size="small" exclusive value={props.viewMode} onChange={(_, v) => v && props.onViewMode(v)} data-testid="view-mode">
                            <ToggleButton value="both" sx={{ py: 0, px: 1, color: '#fff', borderColor: 'rgba(255,255,255,0.2)', textTransform: 'none', '&.Mui-selected': { background: 'rgba(102,229,255,0.3)', color: '#fff' } }}>God view</ToggleButton>
                            {(['p1', 'p2'] as Seat[]).map((s) => (
                                <ToggleButton key={s} value={s} sx={{ py: 0, px: 1, color: SEAT_COLOR[s], borderColor: 'rgba(255,255,255,0.2)', textTransform: 'none', '&.Mui-selected': { background: SEAT_COLOR[s], color: '#000' } }}>
                                    as {seatLabel(s)}
                                </ToggleButton>
                            ))}
                        </ToggleButtonGroup>
                    </Tooltip>
                    {props.viewMode === 'both' && (
                        <Tooltip title="Which seat sits at the bottom of the board">
                            <Select size="small" variant="standard" disableUnderline value={props.orientation} onChange={(e) => props.onOrientation(e.target.value as Orientation)} sx={{ color: '#fff', fontSize: '0.8rem', '& .MuiSelect-icon': { color: '#fff' } }} data-testid="orientation">
                                <MenuItem value="decider">Decider at bottom</MenuItem>
                                <MenuItem value="p1">P1 at bottom</MenuItem>
                                <MenuItem value="p2">P2 at bottom</MenuItem>
                            </Select>
                        </Tooltip>
                    )}
                    <Tooltip title="Back to the start position (the move tree is kept)">
                        <Button size="small" sx={pillButtonSx} startIcon={<FirstPageIcon sx={{ fontSize: '1rem !important' }} />} onClick={props.onResetToStart} data-testid="reset-to-start">Start</Button>
                    </Tooltip>
                    <Tooltip title="Open the board as it is now in Edit, as a new start position">
                        <Button size="small" sx={pillButtonSx} startIcon={<EditIcon sx={{ fontSize: '0.95rem !important' }} />} onClick={props.onEditFromHere} data-testid="edit-from-here">Edit from here</Button>
                    </Tooltip>
                </>
            )}
            <Box sx={{ flex: 1, minWidth: 0, display: 'flex' }} data-testid="position-title">
                <Box component="span" sx={{ display: 'none' }}>{props.title}</Box>
                <TitleField title={props.title} onChange={props.onTitleChange} editable={mode === 'edit'} />
            </Box>
            {props.toast && <Typography sx={{ fontSize: '0.8rem', m: 0, color: 'var(--selection-green)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '22rem' }} data-testid="toast">{props.toast}</Typography>}
            <Tooltip title={mode === 'edit' ? 'Copy the position text' : 'Copy the current board as position text'}>
                <Button size="small" sx={pillButtonSx} startIcon={<ContentCopyIcon sx={{ fontSize: '0.95rem !important' }} />} onClick={props.onCopyText} data-testid="topbar-copy-text">Copy</Button>
            </Tooltip>
            <Tooltip title="Copy a link that opens this position">
                <Button size="small" sx={pillButtonSx} startIcon={<LinkIcon sx={{ fontSize: '1rem !important' }} />} onClick={props.onCopyLink} data-testid="topbar-copy-link">Share</Button>
            </Tooltip>
            <Tooltip title={`${STATUS_TEXT[props.engineStatus]}${props.engineDetail ? ` (${props.engineDetail})` : ''}. ${props.engineKind === 'worker' ? 'Runs in this browser tab; no server.' : 'Talking to the dev server on :9600 (?engine=socket).'}`}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', flex: '0 0 auto' }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', background: STATUS_COLOR[props.engineStatus] }} data-testid="engine-status" data-status={props.engineStatus} data-engine={props.engineKind} />
                    <Typography sx={{ fontSize: '0.68rem', m: 0, color: 'rgba(255,255,255,0.5)' }}>{props.engineKind === 'worker' ? 'in-browser' : 'server'}</Typography>
                </Box>
            </Tooltip>
            <Tooltip title={props.panelOpen ? 'Hide the side panel' : 'Show the side panel'}>
                <Button size="small" sx={{ ...pillButtonSx, px: 1 }} onClick={props.onTogglePanel} aria-label="Toggle side panel" data-testid="toggle-panel">
                    <ViewSidebarIcon sx={{ fontSize: '1.05rem', opacity: props.panelOpen ? 1 : 0.6 }} />
                </Button>
            </Tooltip>
        </Box>
    );
};

export default TopBar;
