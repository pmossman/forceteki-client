'use client';
import React, { useState } from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { Seat } from '../../_engine/SandboxEngine';
import { SEAT_COLOR, SEAT_TINT, sectionTitleSx } from '../sandboxTheme';

interface IZoneBoxProps {
    seat: Seat;
    label: string;
    count?: number | string;
    isTarget: boolean;
    onTarget: () => void;
    onAdd: () => void;
    onDropCard: (data: { uid?: string; cardName?: string }) => void;
    children: React.ReactNode;
    extra?: React.ReactNode;
    sx?: object;
    contentSx?: object;
    testId?: string;
}

/** A drop-target zone in the editor: click to make it where search results go, drag cards in. */
const ZoneBox: React.FC<IZoneBoxProps> = ({ seat, label, count, isTarget, onTarget, onAdd, onDropCard, children, extra, sx, contentSx, testId }) => {
    const [dragOver, setDragOver] = useState(false);
    return (
        <Box
            data-testid={testId}
            onClick={onTarget}
            onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const uid = e.dataTransfer.getData('application/x-sandbox-uid') || undefined;
                const cardName = e.dataTransfer.getData('application/x-sandbox-card') || undefined;
                if (uid || cardName) {
                    onDropCard({ uid, cardName });
                }
            }}
            sx={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                minWidth: 0,
                borderRadius: '10px',
                border: isTarget || dragOver ? `1.5px dashed ${SEAT_COLOR[seat]}` : '1px solid rgba(255,255,255,0.10)',
                background: isTarget || dragOver ? SEAT_TINT[seat] : 'rgba(0,0,0,0.38)',
                transition: 'background 0.15s, border-color 0.15s',
                p: '6px 8px 8px',
                cursor: 'copy',
                ...sx,
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', mb: '4px', minHeight: '22px' }}>
                <Typography sx={{ ...sectionTitleSx, color: isTarget ? SEAT_COLOR[seat] : sectionTitleSx.color }}>{label}</Typography>
                {count !== undefined && <Typography sx={{ ...sectionTitleSx, color: 'rgba(255,255,255,0.4)' }}>{count}</Typography>}
                <Box sx={{ flex: 1 }} />
                {extra}
                <Tooltip title={`Add a card to ${label.toLowerCase()}`}>
                    <IconButton
                        size="small"
                        aria-label={`Add to ${label}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            onAdd();
                        }}
                        sx={{ p: '2px', color: SEAT_COLOR[seat], background: 'rgba(255,255,255,0.06)', '&:hover': { background: 'rgba(255,255,255,0.16)' } }}
                    >
                        <AddIcon sx={{ fontSize: '1rem' }} />
                    </IconButton>
                </Tooltip>
            </Box>
            <Box sx={{ display: 'flex', gap: '8px', alignItems: 'flex-start', flexWrap: 'wrap', minHeight: 0, flex: 1, overflow: 'auto', ...contentSx }}>
                {children}
            </Box>
        </Box>
    );
};

export default ZoneBox;
