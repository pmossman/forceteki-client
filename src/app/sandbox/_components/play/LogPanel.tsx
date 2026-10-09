'use client';
import React, { useEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { panelSx, sectionTitleSx } from '../sandboxTheme';

/** The engine's game log for the current frame (plain text, oldest first). Collapsed by default. */
const LogPanel: React.FC<{ log: string[]; errors?: string[] }> = ({ log, errors }) => {
    const [open, setOpen] = useState(false);
    const endRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (open) {
            endRef.current?.scrollIntoView({ block: 'end' });
        }
    }, [log.length, open]);

    return (
        <Box sx={{ ...panelSx, p: '8px 10px', display: 'flex', flexDirection: 'column', minHeight: 0, flex: open ? '0 1 30%' : '0 0 auto' }} data-testid="log-panel">
            <Typography sx={{ ...sectionTitleSx, cursor: 'pointer' }} onClick={() => setOpen(!open)}>
                {open ? '▾' : '▸'} Game log ({log.length}){errors?.length ? ` · ${errors.length} engine error${errors.length > 1 ? 's' : ''}` : ''}
            </Typography>
            {!open && log.length > 0 && (
                <Typography sx={{ fontSize: '0.72rem', m: '3px 0 0', color: 'rgba(255,255,255,0.6)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {log[log.length - 1]}
                </Typography>
            )}
            {open && (
                <Box sx={{ overflowY: 'auto', minHeight: 0, mt: '4px' }}>
                    {errors?.map((e, i) => (
                        <Typography key={`e${i}`} sx={{ fontSize: '0.72rem', m: 0, color: '#ff8a8a' }}>{e}</Typography>
                    ))}
                    {log.map((line, i) => (
                        <Typography key={i} sx={{ fontSize: '0.72rem', m: '0 0 2px', color: 'rgba(255,255,255,0.8)', lineHeight: 1.35 }}>{line}</Typography>
                    ))}
                    <div ref={endRef} />
                </Box>
            )}
        </Box>
    );
};

export default LogPanel;
