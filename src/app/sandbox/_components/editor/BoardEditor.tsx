'use client';
import React, { useEffect } from 'react';
import { Box, Button, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { Seat, seatLabel } from '../../_engine/SandboxEngine';
import { CardIndex } from '../../_lib/cardIndex';
import { EditorApi, findCard } from '../../_lib/useEditor';
import { emptyPosition } from '../../_lib/position';
import PlayerHalf from './PlayerHalf';
import { SEAT_COLOR, pillButtonSx, primaryButtonSx } from '../sandboxTheme';

interface IBoardEditorProps {
    editor: EditorApi;
    index: CardIndex;
    onRequestSearch: () => void;
    onPlay: () => void;
    playDisabledReason: string | null;
    starting: boolean;
    /** keyboard shortcuts only while the editor is on screen */
    active: boolean;
}

const BoardEditor: React.FC<IBoardEditorProps> = ({ editor, index, onRequestSearch, onPlay, playDisabledReason, starting, active }) => {
    const pos = editor.position;

    // Keyboard shortcuts (DESIGN §3): D / Shift+D damage, E exhaust, S shield, X experience, Del remove, Cmd/Ctrl+Z undo.
    useEffect(() => {
        if (!active) {
            return;
        }
        const onKey = (e: KeyboardEvent) => {
            const el = e.target as HTMLElement;
            if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
                return;
            }
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    editor.redo();
                } else {
                    editor.undo();
                }
                return;
            }
            if (e.metaKey || e.ctrlKey || e.altKey) {
                return;
            }
            if (e.key === '/' ) {
                e.preventDefault();
                onRequestSearch();
                return;
            }
            const sel = editor.selection;
            if (!sel) {
                return;
            }
            const found = findCard(editor.position, sel.uid);
            if (!found) {
                return;
            }
            const key = e.key.toLowerCase();
            if (key === 'd') {
                editor.update(sel.uid, { damage: Math.max(0, (found.card.damage ?? 0) + (e.shiftKey ? -1 : 1)) });
            } else if (key === 'e') {
                editor.update(sel.uid, { exhausted: !found.card.exhausted });
            } else if (key === 's') {
                editor.bumpToken(sel.uid, 'shield', e.shiftKey ? -1 : 1);
            } else if (key === 'x') {
                editor.bumpToken(sel.uid, 'experience', e.shiftKey ? -1 : 1);
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                editor.remove(sel.uid);
            } else if (e.key === 'Escape') {
                editor.select(null);
            } else {
                return;
            }
            e.preventDefault();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [editor, onRequestSearch, active]);

    const seatToggle = (value: Seat, onChange: (s: Seat) => void, label: string, testId: string) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Typography sx={{ fontSize: '0.72rem', m: 0, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{label}</Typography>
            <ToggleButtonGroup size="small" exclusive value={value} onChange={(_, v) => v && onChange(v)} data-testid={testId}>
                {(['p1', 'p2'] as Seat[]).map((s) => (
                    <ToggleButton
                        key={s}
                        value={s}
                        sx={{ py: 0, px: 1.2, color: SEAT_COLOR[s], borderColor: 'rgba(255,255,255,0.2)', fontWeight: 800, '&.Mui-selected': { background: SEAT_COLOR[s], color: '#000', '&:hover': { background: SEAT_COLOR[s] } } }}
                    >
                        {seatLabel(s)}
                    </ToggleButton>
                ))}
            </ToggleButtonGroup>
        </Box>
    );

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px', height: '100%', minHeight: 0 }} data-testid="board-editor">
            <PlayerHalf seat="p2" top editor={editor} index={index} onRequestSearch={onRequestSearch} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '14px', px: '6px', py: '2px', flexWrap: 'wrap', flex: '0 0 auto' }}>
                {seatToggle(pos.initiative, (s) => editor.setMeta({ initiative: s, active: undefined }), 'Initiative', 'initiative-toggle')}
                {seatToggle(pos.active ?? pos.initiative, (s) => editor.setMeta({ active: s === pos.initiative ? undefined : s }), 'Acts first', 'active-toggle')}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Typography sx={{ fontSize: '0.72rem', m: 0, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Phase</Typography>
                    <ToggleButtonGroup size="small" exclusive value={pos.phase} onChange={(_, v) => v && editor.setMeta({ phase: v })}>
                        {(['action', 'regroup'] as const).map((ph) => (
                            <ToggleButton key={ph} value={ph} sx={{ py: 0, px: 1.2, color: '#fff', borderColor: 'rgba(255,255,255,0.2)', textTransform: 'none', '&.Mui-selected': { background: 'rgba(102,229,255,0.3)', color: '#fff' } }}>
                                {ph === 'action' ? 'Action' : 'Regroup'}
                            </ToggleButton>
                        ))}
                    </ToggleButtonGroup>
                </Box>
                <Tooltip title="Undo (⌘Z)"><span><Button size="small" sx={pillButtonSx} disabled={!editor.canUndo} onClick={editor.undo} aria-label="Undo"><UndoIcon sx={{ fontSize: '1rem' }} /></Button></span></Tooltip>
                <Tooltip title="Redo (⇧⌘Z)"><span><Button size="small" sx={pillButtonSx} disabled={!editor.canRedo} onClick={editor.redo} aria-label="Redo"><RedoIcon sx={{ fontSize: '1rem' }} /></Button></span></Tooltip>
                <Tooltip title="Swap the two sides"><Button size="small" sx={pillButtonSx} onClick={editor.swapSides} startIcon={<SwapVertIcon sx={{ fontSize: '1rem' }} />}>Swap sides</Button></Tooltip>
                <Button size="small" sx={pillButtonSx} onClick={() => editor.replace(emptyPosition())}>Clear</Button>
                <Box sx={{ flex: 1 }} />
                <Tooltip title={playDisabledReason ?? 'Start playing this position (both seats on this screen)'}>
                    <span>
                        <Button
                            sx={{ ...primaryButtonSx, py: 0.6, px: 2.4, fontSize: '0.95rem' }}
                            disabled={!!playDisabledReason || starting}
                            onClick={onPlay}
                            startIcon={<PlayArrowIcon />}
                            data-testid="play-position"
                        >
                            {starting ? 'Starting…' : 'Play this position'}
                        </Button>
                    </span>
                </Tooltip>
            </Box>
            <PlayerHalf seat="p1" top={false} editor={editor} index={index} onRequestSearch={onRequestSearch} />
        </Box>
    );
};

export default BoardEditor;
