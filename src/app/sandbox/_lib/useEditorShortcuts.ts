'use client';
import { useEffect } from 'react';
import { EditorApi } from './useEditor';

/** Undo / redo for edits: Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z. (Per-card keys live in EditOverlay.) */
export const useEditorShortcuts = (editor: EditorApi, active: boolean) => {
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
            // card keys (Delete, [ ], E, S, X) act on the hovered card: see EditOverlay
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [editor, active]);
};
