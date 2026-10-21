import type { Ledger } from './ledger.ts';
export type Conflict = {
    path: string;
    base: unknown;
    local: unknown;
    remote: unknown;
};
export function mergeLedgers(base: Ledger, local: Ledger, remote: Ledger, choices: Record<string, 'local' | 'remote'> = {}) {
    const conflicts: Conflict[] = [];
    const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    function merge(b: any, l: any, r: any, path: string): any {
        if (equal(l, r))
            return l;
        if (equal(l, b))
            return r;
        if (equal(r, b))
            return l;
        if (Array.isArray(l) && Array.isArray(r) && [...l, ...r, ...(Array.isArray(b) ? b : [])].every(v => v && typeof v === 'object' && typeof v.id === 'string')) {
            const bm = new Map((b || []).map((v: any) => [v.id, v])), lm = new Map(l.map(v => [v.id, v])), rm = new Map(r.map(v => [v.id, v]));
            const ids = [...new Set([...rm.keys(), ...lm.keys(), ...bm.keys()])];
            return ids.map(id => merge(bm.get(id), lm.get(id), rm.get(id), path + '/' + id)).filter(v => v !== undefined);
        }
        if ((/^账本\/hkSecurities\/(accounts|events|quotes)\//.test(path) && path.split('/').length === 4) || (path.startsWith('账本/transactions/') && path.split('/').length === 3) || (path.startsWith('账本/digital/events/') && path.split('/').length === 4) || (path.startsWith('账本/digital/manualBalances/') && path.split('/').length === 4) || (path.startsWith('账本/accounts/') && path.split('/').length === 3)) {
            if (choices[path])
                return choices[path] === 'local' ? l : r;
            conflicts.push({ path, base: b, local: l, remote: r });
            return r;
        }
        if (l && r && typeof l === 'object' && typeof r === 'object' && !Array.isArray(l) && !Array.isArray(r)) {
            const out: Record<string, unknown> = {};
            for (const k of new Set([...Object.keys(b || {}), ...Object.keys(l), ...Object.keys(r)])) {
                const v = merge(b?.[k], l[k], r[k], path + '/' + k);
                if (v !== undefined)
                    out[k] = v;
            }
            return out;
        }
        if (choices[path])
            return choices[path] === 'local' ? l : r;
        conflicts.push({ path, base: b, local: l, remote: r });
        return r;
    }
    const ledger = merge(base, local, remote, '账本') as Ledger;
    return { ledger, conflicts };
}
