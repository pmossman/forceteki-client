'use client';
import React, { useEffect, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LinkIcon from '@mui/icons-material/Link';
import { IValidationIssue } from '../../_lib/validate';
import { panelSx, pillButtonSx, sectionTitleSx } from '../sandboxTheme';

interface IPositionPanelProps {
    text: string;
    issues: IValidationIssue[];

    /** returns parse/resolve errors; empty means the text was applied */
    onApplyText: (text: string) => IValidationIssue[];
    onCopyText: () => void;
    onCopyLink: () => void;
    collapsed: boolean;
    onToggle: () => void;

    /** Play mode: shows the current board's position, not editable */
    readOnly?: boolean;
}

/** The position as text (POSITION-FORMAT.md): edit and apply, copy, or share as a link. Like Lichess's FEN box. */
const PositionPanel: React.FC<IPositionPanelProps> = ({ text, issues, onApplyText, onCopyText, onCopyLink, collapsed, onToggle, readOnly }) => {
    const [draft, setDraft] = useState(text);
    const [dirty, setDirty] = useState(false);
    const [parseIssues, setParseIssues] = useState<IValidationIssue[]>([]);

    useEffect(() => {
        if (!dirty) {
            setDraft(text);
        }
    }, [text, dirty]);

    const apply = () => {
        const errs = onApplyText(draft);
        setParseIssues(errs);
        if (errs.length === 0) {
            setDirty(false);
        }
    };

    const shown = dirty || parseIssues.length ? parseIssues : issues;
    const errors = shown.filter((i) => i.severity === 'error');
    const warnings = shown.filter((i) => i.severity === 'warning');

    return (
        <Box sx={{ ...panelSx, p: '10px', display: 'flex', flexDirection: 'column', gap: '6px', minHeight: '16rem', flex: collapsed ? '0 0 auto' : '1 0 16rem' }} data-testid="position-panel">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Typography sx={{ ...sectionTitleSx, cursor: 'pointer' }} onClick={onToggle}>{readOnly ? 'Current position' : 'Start position'} (text)</Typography>
                {errors.length > 0 && <Typography sx={{ fontSize: '0.7rem', m: 0, color: '#ff7b7b' }}>{errors.length} error{errors.length > 1 ? 's' : ''}</Typography>}
                {errors.length === 0 && warnings.length > 0 && <Typography sx={{ fontSize: '0.7rem', m: 0, color: '#ffd166' }}>{warnings.length} warning{warnings.length > 1 ? 's' : ''}</Typography>}
                <Box sx={{ flex: 1 }} />
                <Button size="small" sx={pillButtonSx} onClick={onCopyText} startIcon={<ContentCopyIcon sx={{ fontSize: '0.9rem !important' }} />} data-testid="copy-position-text">Copy</Button>
                <Button size="small" sx={pillButtonSx} onClick={onCopyLink} startIcon={<LinkIcon sx={{ fontSize: '1rem !important' }} />} data-testid="copy-position-link">Link</Button>
            </Box>
            {!collapsed && (
                <>
                    <Box
                        component="textarea"
                        value={readOnly ? text : draft}
                        readOnly={readOnly}
                        spellCheck={false}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                            setDraft(e.target.value);
                            setDirty(true);
                        }}
                        onBlur={() => dirty && apply()}
                        onKeyDown={(e: React.KeyboardEvent) => {
                            e.stopPropagation();
                            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                                e.preventDefault();
                                apply();
                            }
                        }}
                        data-testid="position-text"
                        sx={{
                            flex: 1,
                            minHeight: '8rem',
                            resize: 'none',
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                            fontSize: '0.74rem',
                            lineHeight: 1.45,
                            color: '#e8f6ff',
                            background: 'rgba(255,255,255,0.05)',
                            border: dirty ? '1px solid var(--selection-yellow)' : '1px solid rgba(255,255,255,0.12)',
                            borderRadius: '6px',
                            p: '8px',
                            outline: 'none',
                        }}
                    />
                    <Box sx={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        {readOnly ? (
                            <Typography sx={{ fontSize: '0.66rem', m: 0, color: 'rgba(255,255,255,0.4)' }}>The board as it is now. &ldquo;Edit from here&rdquo; opens it in Edit.</Typography>
                        ) : dirty ? (
                            <>
                                <Button size="small" sx={{ ...pillButtonSx, borderColor: 'var(--selection-yellow)' }} onClick={apply} data-testid="apply-position-text">Apply (⌘↵)</Button>
                                <Button size="small" sx={pillButtonSx} onClick={() => {
                                    setDirty(false);
                                    setParseIssues([]);
                                    setDraft(text);
                                }}>Revert</Button>
                            </>
                        ) : (
                            <Typography sx={{ fontSize: '0.66rem', m: 0, color: 'rgba(255,255,255,0.4)' }}>Edit or paste a position here; it applies when you click away.</Typography>
                        )}
                    </Box>
                    {shown.length > 0 && (
                        <Box sx={{ maxHeight: '7rem', overflowY: 'auto' }} data-testid="position-issues">
                            {[...errors, ...warnings].map((i, k) => (
                                <Typography key={k} sx={{ fontSize: '0.72rem', m: 0, color: i.severity === 'error' ? '#ff8a8a' : '#ffd166' }}>
                                    {i.line ? `line ${i.line}: ` : ''}{i.message}
                                </Typography>
                            ))}
                        </Box>
                    )}
                </>
            )}
        </Box>
    );
};

export default PositionPanel;
