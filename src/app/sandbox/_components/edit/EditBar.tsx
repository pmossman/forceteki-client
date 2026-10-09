'use client';
import React from 'react';
import { Box, Button, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { Seat, seatLabel } from '../../_engine/SandboxEngine';
import { EditorApi } from '../../_lib/useEditor';
import { emptyPosition } from '../../_lib/position';
import { IValidationIssue } from '../../_lib/validate';
import { SEAT_COLOR, pillButtonSx, primaryButtonSx } from '../sandboxTheme';

interface IEditBarProps {
    editor: EditorApi;
    issues: IValidationIssue[];
    onPlay: () => void;
    playDisabledReason: string | null;
    starting: boolean;
    resumeTitle: string | null;
}

const labelSx = { fontSize: '0.68rem', m: 0, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase' as const, letterSpacing: '0.08em', fontWeight: 700 };

/** Edit mode's strip above the board (where Play shows the prompt dock): global position settings and Play. */
const EditBar: React.FC<IEditBarProps> = ({ editor, issues, onPlay, playDisabledReason, starting, resumeTitle }) => {
    const pos = editor.position;
    const errors = issues.filter((i) => i.severity === 'error');
    const seatToggle = (value: Seat, onChange: (s: Seat) => void, testId: string) => (
        <ToggleButtonGroup size="small" exclusive value={value} onChange={(_, v) => v && onChange(v)} data-testid={testId}>
            {(['p1', 'p2'] as Seat[]).map((s) => (
                <ToggleButton key={s} value={s} sx={{ py: 0, px: 1, color: SEAT_COLOR[s], borderColor: 'rgba(255,255,255,0.2)', fontWeight: 800, '&.Mui-selected': { background: SEAT_COLOR[s], color: '#000', '&:hover': { background: SEAT_COLOR[s] } } }}>
                    {seatLabel(s)}
                </ToggleButton>
            ))}
        </ToggleButtonGroup>
    );

    return (
        <Box
            data-testid="edit-bar"
            sx={{
                display: 'flex', alignItems: 'center', gap: '12px', px: '12px', py: '6px', minHeight: '46px', flexWrap: 'wrap',
                background: 'linear-gradient(90deg, rgba(255,254,80,0.10), rgba(0,0,0,0.78) 45%)',
                borderBottom: '2px solid rgba(255,254,80,0.55)', position: 'relative', zIndex: 5,
            }}
        >
            <Typography sx={{ fontWeight: 800, fontSize: '0.95rem', m: 0, color: 'var(--selection-yellow)', letterSpacing: '0.06em' }}>EDITING</Typography>
            <Typography sx={{ fontSize: '0.78rem', m: 0, color: 'rgba(255,255,255,0.65)' }}>
                {resumeTitle ? `the start of “${resumeTitle}”` : 'the start position'} · click a card to change it · “+” adds cards
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Typography sx={labelSx}>Initiative</Typography>
                {seatToggle(pos.initiative, (s) => editor.setMeta({ initiative: s, active: undefined }), 'initiative-toggle')}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Typography sx={labelSx}>Acts first</Typography>
                {seatToggle(pos.active ?? pos.initiative, (s) => editor.setMeta({ active: s === pos.initiative ? undefined : s }), 'active-toggle')}
            </Box>
            <ToggleButtonGroup size="small" exclusive value={pos.phase} onChange={(_, v) => v && editor.setMeta({ phase: v })}>
                {(['action', 'regroup'] as const).map((ph) => (
                    <ToggleButton key={ph} value={ph} sx={{ py: 0, px: 1, color: '#fff', borderColor: 'rgba(255,255,255,0.2)', textTransform: 'none', '&.Mui-selected': { background: 'rgba(102,229,255,0.3)', color: '#fff' } }}>
                        {ph === 'action' ? 'Action phase' : 'Regroup'}
                    </ToggleButton>
                ))}
            </ToggleButtonGroup>
            <Tooltip title="Undo (⌘Z)"><span><Button size="small" sx={pillButtonSx} disabled={!editor.canUndo} onClick={editor.undo} aria-label="Undo"><UndoIcon sx={{ fontSize: '1rem' }} /></Button></span></Tooltip>
            <Tooltip title="Redo (⇧⌘Z)"><span><Button size="small" sx={pillButtonSx} disabled={!editor.canRedo} onClick={editor.redo} aria-label="Redo"><RedoIcon sx={{ fontSize: '1rem' }} /></Button></span></Tooltip>
            <Tooltip title="Swap the two sides"><Button size="small" sx={pillButtonSx} onClick={editor.swapSides} aria-label="Swap sides"><SwapVertIcon sx={{ fontSize: '1rem' }} /></Button></Tooltip>
            <Tooltip title="Empty the board (keeps nothing)"><Button size="small" sx={pillButtonSx} onClick={() => editor.replace(emptyPosition())}>Clear</Button></Tooltip>
            {errors.length > 0 && (
                <Tooltip title={errors.map((e) => e.message).join('\n')}>
                    <Typography sx={{ fontSize: '0.75rem', m: 0, color: '#ff8a8a', fontWeight: 700 }} data-testid="edit-errors">{errors.length} problem{errors.length > 1 ? 's' : ''}</Typography>
                </Tooltip>
            )}
            <Tooltip title={playDisabledReason ?? 'Play from this position (both seats on this screen)'}>
                <span>
                    <Button sx={{ ...primaryButtonSx, py: 0.4, px: 2 }} disabled={!!playDisabledReason || starting} onClick={onPlay} startIcon={<PlayArrowIcon />} data-testid="play-position">
                        {starting ? 'Starting…' : 'Play'}
                    </Button>
                </span>
            </Tooltip>
        </Box>
    );
};

export default EditBar;
