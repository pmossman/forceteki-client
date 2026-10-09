'use client';
import React, { useState } from 'react';
import { Box, Button, Divider, InputBase, ListItemText, Menu, MenuItem, Tooltip, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import EditIcon from '@mui/icons-material/Edit';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LinkIcon from '@mui/icons-material/Link';
import SaveIcon from '@mui/icons-material/Save';
import { EngineStatus } from '../_engine/SandboxEngine';
import { PRESETS } from '../_lib/presets';
import { ISavedAnalysis, ISavedPosition } from '../_lib/storage';
import { pillButtonSx } from './sandboxTheme';

export type SandboxMode = 'setup' | 'analyse';

interface ITopBarProps {
    mode: SandboxMode;
    onMode: (m: SandboxMode) => void;
    analyseAvailable: boolean;
    title: string;
    engineStatus: EngineStatus;
    engineDetail?: string;
    engineKind: string;
    savedPositions: ISavedPosition[];
    savedAnalyses: ISavedAnalysis[];
    onPreset: (id: string) => void;
    onLoadSaved: (p: ISavedPosition) => void;
    onDeleteSaved: (id: string) => void;
    onResumeAnalysis: (a: ISavedAnalysis) => void;
    onSavePosition: () => void;
    onCopyText: () => void;
    onCopyLink: () => void;
    onEditCurrent?: () => void;
    onTitleChange?: (title: string) => void;
    onOpenSaved?: () => void;
    toast: string | null;
}

const TitleField: React.FC<{ title: string; onChange: (t: string) => void }> = ({ title, onChange }) => {
    const [draft, setDraft] = useState<string | null>(null);
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

const STATUS_COLOR: Record<EngineStatus, string> = { ready: '#4cd964', connecting: '#ffd166', disconnected: '#ff8a8a', error: '#ff5c5c' };
const STATUS_TEXT: Record<EngineStatus, string> = { ready: 'Engine ready', connecting: 'Starting the engine…', disconnected: 'Engine disconnected', error: 'Engine unavailable' };

const TopBar: React.FC<ITopBarProps> = (props) => {
    const { mode, onMode, analyseAvailable, title, engineStatus, engineDetail, toast } = props;
    const [presetAnchor, setPresetAnchor] = useState<HTMLElement | null>(null);
    const [savedAnchor, setSavedAnchor] = useState<HTMLElement | null>(null);

    const tab = (m: SandboxMode, label: string, disabled = false) => (
        <Button
            onClick={() => onMode(m)}
            disabled={disabled}
            data-testid={`mode-${m}`}
            sx={{
                color: mode === m ? '#000' : '#fff',
                background: mode === m ? 'var(--initiative-blue)' : 'transparent',
                fontWeight: 800,
                letterSpacing: '0.06em',
                borderRadius: '999px',
                px: 2,
                py: 0.2,
                minWidth: 0,
                '&:hover': { background: mode === m ? 'var(--initiative-blue)' : 'rgba(255,255,255,0.1)' },
                '&.Mui-disabled': { color: 'rgba(255,255,255,0.3)' },
            }}
        >
            {label}
        </Button>
    );

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', px: '12px', height: '48px', flex: '0 0 auto', background: 'rgba(0,0,0,0.85)', borderBottom: '1px solid rgba(255,255,255,0.12)', position: 'relative', zIndex: 20 }}>
            <Box component="img" src="/karabastTiny.png" alt="" sx={{ height: 26 }} />
            <Typography sx={{ fontWeight: 800, letterSpacing: '0.12em', fontSize: '0.95rem', m: 0 }}>KARABAST <Box component="span" sx={{ color: 'var(--initiative-blue)' }}>SANDBOX</Box></Typography>
            <Box sx={{ display: 'flex', gap: '4px', p: '3px', borderRadius: '999px', border: '1px solid rgba(255,255,255,0.15)', ml: 1 }}>
                {tab('setup', 'SET UP')}
                {tab('analyse', 'PLAY & ANALYSE', !analyseAvailable)}
            </Box>
            {mode === 'setup' && props.onTitleChange ? (
                <Box sx={{ flex: 1, minWidth: 0, display: 'flex' }} data-testid="position-title" title={title}>
                    <Box component="span" sx={{ display: 'none' }}>{title}</Box>
                    <TitleField title={title === 'Untitled position' ? '' : title} onChange={props.onTitleChange} />
                </Box>
            ) : (
                <Typography sx={{ fontSize: '0.85rem', m: 0, color: 'rgba(255,255,255,0.7)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: 1 }} data-testid="position-title">
                    {title}
                </Typography>
            )}
            {toast && <Typography sx={{ fontSize: '0.8rem', m: 0, color: 'var(--selection-green)' }} data-testid="toast">{toast}</Typography>}

            {mode === 'setup' && (
                <>
                    <Button size="small" sx={pillButtonSx} endIcon={<ExpandMoreIcon />} onClick={(e) => setPresetAnchor(e.currentTarget)} data-testid="presets-button">Presets</Button>
                    <Menu anchorEl={presetAnchor} open={!!presetAnchor} onClose={() => setPresetAnchor(null)}>
                        {PRESETS.map((p) => (
                            <MenuItem key={p.id} onClick={() => {
                                setPresetAnchor(null);
                                props.onPreset(p.id);
                            }} data-testid={`preset-${p.id}`}>
                                <ListItemText primary={p.title} secondary={p.description} />
                            </MenuItem>
                        ))}
                    </Menu>
                </>
            )}
            <Button size="small" sx={pillButtonSx} endIcon={<ExpandMoreIcon />} onClick={(e) => {
                props.onOpenSaved?.();
                setSavedAnchor(e.currentTarget);
            }} data-testid="saved-button">Saved</Button>
            <Menu anchorEl={savedAnchor} open={!!savedAnchor} onClose={() => setSavedAnchor(null)} slotProps={{ paper: { sx: { maxHeight: '70vh', minWidth: 320 } } }}>
                <MenuItem disabled dense><Typography sx={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.08em' }}>POSITIONS</Typography></MenuItem>
                {props.savedPositions.length === 0 && <MenuItem disabled dense>Nothing saved yet</MenuItem>}
                {props.savedPositions.map((p) => (
                    <MenuItem key={p.id} onClick={() => {
                        setSavedAnchor(null);
                        props.onLoadSaved(p);
                    }}>
                        <ListItemText primary={p.name} secondary={new Date(p.savedAt).toLocaleString()} />
                        <Button size="small" sx={{ ml: 1, color: '#ff8a8a', minWidth: 0 }} onClick={(e) => {
                            e.stopPropagation();
                            props.onDeleteSaved(p.id);
                        }}>✕</Button>
                    </MenuItem>
                ))}
                <Divider />
                <MenuItem disabled dense><Typography sx={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.08em' }}>ANALYSES (auto-saved)</Typography></MenuItem>
                {props.savedAnalyses.length === 0 && <MenuItem disabled dense>No analyses yet</MenuItem>}
                {props.savedAnalyses.map((a) => (
                    <MenuItem key={a.id} onClick={() => {
                        setSavedAnchor(null);
                        props.onResumeAnalysis(a);
                    }} data-testid={`saved-analysis-${a.id}`}>
                        <ListItemText primary={a.name} secondary={`${a.data.nodes.length - 1} decisions · ${new Date(a.savedAt).toLocaleString()}`} />
                    </MenuItem>
                ))}
            </Menu>
            {mode === 'setup' ? (
                <Tooltip title="Save this position in this browser"><Button size="small" sx={pillButtonSx} startIcon={<SaveIcon sx={{ fontSize: '1rem !important' }} />} onClick={props.onSavePosition} data-testid="save-position">Save</Button></Tooltip>
            ) : (
                <Tooltip title="Open the current board in the editor"><Button size="small" sx={pillButtonSx} startIcon={<EditIcon sx={{ fontSize: '1rem !important' }} />} onClick={props.onEditCurrent} data-testid="edit-current">Edit this position</Button></Tooltip>
            )}
            <Tooltip title={mode === 'setup' ? 'Copy the position text' : 'Copy the current board as position text'}>
                <Button size="small" sx={pillButtonSx} startIcon={<ContentCopyIcon sx={{ fontSize: '0.95rem !important' }} />} onClick={props.onCopyText} data-testid="topbar-copy-text">Copy position</Button>
            </Tooltip>
            <Tooltip title="Copy a link that opens this position">
                <Button size="small" sx={pillButtonSx} startIcon={<LinkIcon sx={{ fontSize: '1rem !important' }} />} onClick={props.onCopyLink} data-testid="topbar-copy-link">Share link</Button>
            </Tooltip>
            <Tooltip title={`${STATUS_TEXT[engineStatus]}${engineDetail ? ` (${engineDetail})` : ''}. ${props.engineKind === 'worker' ? 'Runs in this browser tab; no server.' : 'Talking to the dev server on :9600 (?engine=socket).'}`}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', flex: '0 0 auto' }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', background: STATUS_COLOR[engineStatus] }} data-testid="engine-status" data-status={engineStatus} data-engine={props.engineKind} />
                    <Typography sx={{ fontSize: '0.68rem', m: 0, color: 'rgba(255,255,255,0.5)' }}>{props.engineKind === 'worker' ? 'in-browser' : 'server'}</Typography>
                </Box>
            </Tooltip>
        </Box>
    );
};

export default TopBar;
