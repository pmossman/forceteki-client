'use client';
import React from 'react';
import { Box, Button, IconButton, Tooltip, Typography } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import SaveIcon from '@mui/icons-material/Save';
import { PRESETS } from '../../_lib/presets';
import { ISavedAnalysis, ISavedPosition } from '../../_lib/storage';
import { IValidationIssue } from '../../_lib/validate';
import PositionPanel from '../editor/PositionPanel';
import { panelSx, pillButtonSx, sectionTitleSx } from '../sandboxTheme';

interface IPositionTabProps {
    editing: boolean;
    text: string;
    issues: IValidationIssue[];
    onApplyText: (text: string) => IValidationIssue[];
    onCopyText: () => void;
    onCopyLink: () => void;
    onPreset: (id: string) => void;
    onSavePosition: () => void;
    savedPositions: ISavedPosition[];
    savedAnalyses: ISavedAnalysis[];
    onLoadSaved: (p: ISavedPosition) => void;
    onDeleteSaved: (id: string) => void;
    onResumeAnalysis: (a: ISavedAnalysis) => void;
}

const listRowSx = {
    display: 'flex', alignItems: 'center', gap: '6px', px: '6px', py: '3px', borderRadius: '6px', cursor: 'pointer',
    '&:hover': { background: 'rgba(255,255,255,0.08)' },
};

/** Presets, the position as text (copy/paste/share) and what is saved in this browser. */
const PositionTab: React.FC<IPositionTabProps> = (props) => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0, flex: 1, overflowY: 'auto' }} data-testid="position-tab">
        <Box sx={{ ...panelSx, p: '10px' }}>
            <Typography sx={sectionTitleSx}>Presets</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', mt: '4px' }}>
                {PRESETS.map((p) => (
                    <Box key={p.id} sx={listRowSx} onClick={() => props.onPreset(p.id)} data-testid={`preset-${p.id}`}>
                        <Box sx={{ minWidth: 0 }}>
                            <Typography sx={{ fontSize: '0.84rem', fontWeight: 700, m: 0 }}>{p.title}</Typography>
                            <Typography sx={{ fontSize: '0.7rem', m: 0, color: 'rgba(255,255,255,0.55)' }}>{p.description}</Typography>
                        </Box>
                    </Box>
                ))}
            </Box>
            {!props.editing && (
                <Typography sx={{ fontSize: '0.68rem', m: '4px 0 0', color: 'rgba(255,255,255,0.45)' }}>Choosing a preset switches to Edit.</Typography>
            )}
        </Box>

        <PositionPanel
            text={props.text}
            issues={props.issues}
            onApplyText={props.onApplyText}
            onCopyText={props.onCopyText}
            onCopyLink={props.onCopyLink}
            collapsed={false}
            onToggle={() => undefined}
            readOnly={!props.editing}
        />

        <Box sx={{ ...panelSx, p: '10px' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Typography sx={sectionTitleSx}>Saved in this browser</Typography>
                <Box sx={{ flex: 1 }} />
                {props.editing && (
                    <Button size="small" sx={pillButtonSx} startIcon={<SaveIcon sx={{ fontSize: '0.95rem !important' }} />} onClick={props.onSavePosition} data-testid="save-position">
                        Save position
                    </Button>
                )}
            </Box>
            {props.savedPositions.length === 0 && props.savedAnalyses.length === 0 && (
                <Typography sx={{ fontSize: '0.74rem', m: '4px 0 0', color: 'rgba(255,255,255,0.5)' }}>Nothing yet. Analyses save themselves as you play.</Typography>
            )}
            {props.savedPositions.length > 0 && <Typography sx={{ ...sectionTitleSx, fontSize: '0.64rem', mt: '6px' }}>Positions</Typography>}
            {props.savedPositions.map((p) => (
                <Box key={p.id} sx={listRowSx} onClick={() => props.onLoadSaved(p)}>
                    <Typography sx={{ fontSize: '0.8rem', m: 0, flex: 1 }}>{p.name}</Typography>
                    <Typography sx={{ fontSize: '0.64rem', m: 0, color: 'rgba(255,255,255,0.4)' }}>{new Date(p.savedAt).toLocaleDateString()}</Typography>
                    <Tooltip title="Delete">
                        <IconButton size="small" sx={{ p: '1px', color: '#ff8a8a' }} onClick={(e) => {
                            e.stopPropagation();
                            props.onDeleteSaved(p.id);
                        }}><DeleteOutlineIcon sx={{ fontSize: '0.9rem' }} /></IconButton>
                    </Tooltip>
                </Box>
            ))}
            {props.savedAnalyses.length > 0 && <Typography sx={{ ...sectionTitleSx, fontSize: '0.64rem', mt: '6px' }}>Analyses (auto-saved)</Typography>}
            {props.savedAnalyses.map((a) => (
                <Box key={a.id} sx={listRowSx} onClick={() => props.onResumeAnalysis(a)} data-testid={`saved-analysis-${a.id}`}>
                    <Typography sx={{ fontSize: '0.8rem', m: 0, flex: 1 }}>{a.name}</Typography>
                    <Typography sx={{ fontSize: '0.64rem', m: 0, color: 'rgba(255,255,255,0.4)' }}>
                        {a.data.nodes.length - 1} decisions · {new Date(a.savedAt).toLocaleDateString()}
                    </Typography>
                </Box>
            ))}
        </Box>
    </Box>
);

export default PositionTab;
