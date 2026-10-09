'use client';
import { useEffect } from 'react';
import { EditorApi, findCard } from './useEditor';

/** DESIGN §3 keys for the selected card: D / Shift+D damage, E exhaust, S shield, X experience, Del remove; Cmd/Ctrl+Z undo. */
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
            if (e.metaKey || e.ctrlKey || e.altKey) {
                return;
            }
            const sel = editor.selection;
            const found = sel ? findCard(editor.position, sel.uid) : null;
            if (!sel || !found) {
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
            } else {
                return;
            }
            e.preventDefault();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [editor, active]);
};
