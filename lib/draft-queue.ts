import type { Tx } from './ledger.ts';

/** Preserve the earlier batch (including user corrections) when recognition finishes. */
export function appendDraftBatch(current: Tx[], incoming: Tx[]): Tx[] {
    const ids = new Set(current.map(t => t.id));
    const appended = incoming.filter(t => {
        if (ids.has(t.id)) return false;
        ids.add(t.id);
        return true;
    });
    return [...current, ...appended];
}

/** Consecutive dictation sessions append; line breaks delimit separate entries. */
export function appendSpokenText(current: string, incoming: string) {
    const next = incoming.trim();
    if (!next) return current;
    return current.trim() ? current.trimEnd() + '\n' + next : next;
}

/** Keep text entered while a cloud recognition request was in flight. */
export function remainingUnparsedText(current: string, submitted: string) {
    if (current === submitted) return '';
    if (submitted && current.startsWith(submitted)) {
        const extra = current.slice(submitted.length);
        if (/^[\s;；，,、]/.test(extra)) return extra.replace(/^[\s;；，,、]+/, '');
    }
    return current;
}
