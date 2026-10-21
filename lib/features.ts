import { newId } from './ids.ts';
import { balances, totals, today, type Account, type Ledger, type Tx } from './ledger.ts';
import { defaultPreferences, type RecurringRule } from './extensions.ts';
export const prefs = (l: Ledger) => ({ ...defaultPreferences, ...l.preferences });
export const budgetFor = (l: Ledger, month: string) => l.monthlyBudgets?.[month] ?? l.budget;
export function isoDate(year: number, month: number, day: number) { const d = new Date(Date.UTC(year, month, 1)); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`; }
export function addDays(date: string, n: number) { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function nextOccurrence(rule: RecurringRule, index: number) { const [y, m, d] = rule.start.split('-').map(Number); return rule.frequency === 'daily' ? addDays(rule.start, index) : rule.frequency === 'weekly' ? addDays(rule.start, index * 7) : rule.frequency === 'monthly' ? isoDate(y, m - 1 + index, d) : isoDate(y + index, m - 1, d); }
export function dueOccurrences(l: Ledger, until = today()) {
    const result: {
        rule: RecurringRule;
        date: string;
        key: string;
    }[] = [];
    const existing = new Set(l.transactions.map(t => t.recurrenceKey).filter(Boolean));
    for (const rule of l.recurring || []) {
        if (!rule.active)
            continue;
        let found = 0;
        for (let i = 0; i < 50000; i++) {
            const date = nextOccurrence(rule, i);
            if (date > until)
                break;
            const key = rule.id + ':' + date;
            if (!existing.has(key)) {
                result.push({ rule, date, key });
                if (++found >= 24)
                    break;
            }
        }
    }
    return result.sort((a, b) => a.date.localeCompare(b.date));
}
export function generateRecurring(l: Ledger, keys?: string[], until = today()): Ledger { const due = dueOccurrences(l, until).filter(d => keys ? keys.includes(d.key) : d.rule.autoDraft); const rows: Tx[] = due.map(({ rule: r, date, key }) => ({ id: newId(), type: r.type, date, amount: r.amount, account: r.account, to: '', channel: r.channel, category: r.category, merchant: r.name, note: '周期账单草稿', status: 'pending', tags: r.tags, recurrenceKey: key, createdAt: new Date().toISOString() })); return { ...l, transactions: [...l.transactions, ...rows] }; }
export function reportTransactions(l: Ledger): Tx[] { if (prefs(l).refundMode !== 'original')
    return l.transactions; const byId = new Map(l.transactions.map(t => [t.id, t])); return l.transactions.map(t => t.type === 'refund' && t.original ? { ...t, date: byId.get(t.original)?.date || t.date } : t); }
export function categoryDescendants(l: Ledger, id: string) { const ids = new Set([id]); for (let i = 0; i < l.categories.length; i++)
    for (const c of l.categories)
        if (c.parent && ids.has(c.parent))
            ids.add(c.id); return ids; }
export function categorySpend(l: Ledger, id: string, month: string) { const ids = categoryDescendants(l, id); return totals(reportTransactions(l).filter(t => t.date.startsWith(month) && ids.has(t.category))).expense; }
export function mergeCategory(l: Ledger, from: string, to: string): Ledger { if (from === to || !l.categories.some(c => c.id === to) || categoryDescendants(l, from).has(to))
    throw Error('不能合并到自身或自己的子分类'); return { ...l, categories: l.categories.map(c => c.id === from ? { ...c, active: false, mergedInto: to } : c.parent === from ? { ...c, parent: to } : c), transactions: l.transactions.map(t => t.category === from ? { ...t, category: to } : t), recurring: l.recurring?.map(r => r.category === from ? { ...r, category: to } : r), merchantRules: l.merchantRules?.map(r => r.category === from ? { ...r, category: to } : r), categoryBudgets: Object.fromEntries(Object.entries(l.categoryBudgets || {}).map(([m, b]) => { const next = { ...b }; if (from in next) {
        next[to] = (next[to] || 0) + next[from];
        delete next[from];
    } return [m, next]; })) }; }
export function creditStatement(l: Ledger, a: Account, at = today()) {
    if (a.kind !== 'debt' || !a.billDay || !a.payDay)
        return null;
    const [y, m, d] = at.split('-').map(Number);
    let close = isoDate(y, m - 1, a.billDay);
    if (close > at)
        close = isoDate(y, m - 2, a.billDay);
    const [cy, cm] = close.split('-').map(Number);
    const start = addDays(isoDate(cy, cm - 2, a.billDay), 1);
    let due = isoDate(cy, cm - 1, a.payDay);
    if (due <= close)
        due = isoDate(cy, cm, a.payDay);
    const atClose = balances({ ...l, transactions: l.transactions.filter(t => t.date <= close), digital: undefined })[a.id];
    const after = l.transactions.filter(t => t.status === 'posted' && t.date > close && t.date <= at);
    let paid = 0;
    for (const t of after) {
        if ((t.type === 'repayment' || t.type === 'transfer') && t.to === a.id)
            paid += t.amount;
        if (t.type === 'refund' && t.account === a.id)
            paid += t.amount;
        if (t.type === 'adjustment' && t.account === a.id && t.adjustmentSide === 'decrease')
            paid += t.amount;
    }
    const outstanding = Math.max(0, atClose - paid);
    const total = Math.max(0, balances(l)[a.id]);
    return { start, close, due, outstanding, total, unbilled: Math.max(0, total - outstanding), overdue: due < at && outstanding > 0 };
}
export function rangeFor(period: 'day' | 'week' | 'month' | 'year', anchor: string) { const [y, m] = anchor.split('-').map(Number); if (period === 'day')
    return { start: anchor, end: anchor }; if (period === 'week') {
    const day = new Date(anchor + 'T12:00:00Z').getUTCDay() || 7;
    const start = addDays(anchor, 1 - day);
    return { start, end: addDays(start, 6) };
} if (period === 'month')
    return { start: isoDate(y, m - 1, 1), end: addDays(isoDate(y, m, 1), -1) }; return { start: y + '-01-01', end: y + '-12-31' }; }
export function previousRange(period: 'day' | 'week' | 'month' | 'year', anchor: string) { const [y, m, d] = anchor.split('-').map(Number); return rangeFor(period, period === 'day' ? addDays(anchor, -1) : period === 'week' ? addDays(anchor, -7) : period === 'month' ? isoDate(y, m - 2, d) : isoDate(y - 1, m - 1, d)); }
export function calendarText(l: Ledger) {
    const events: string[] = [];
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    const add = (id: string, date: string, title: string, rrule = '') => events.push(['BEGIN:VEVENT', `UID:${id}@qingji`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${date.replace(/-/g, '')}`, `SUMMARY:${esc(title)}`, rrule ? 'RRULE:' + rrule : '', 'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', 'DESCRIPTION:账单提醒', 'END:VALARM', 'END:VEVENT'].filter(Boolean).join('\r\n'));
    for (const r of l.recurring || [])
        if (r.active) {
            let count = 0;
            const [sy, sm] = r.start.split('-').map(Number), [ty, tm] = today().split('-').map(Number);
            const days = Math.floor((Date.parse(today()) - Date.parse(r.start)) / 86400000);
            const near = r.frequency === 'daily' ? days : r.frequency === 'weekly' ? Math.floor(days / 7) : r.frequency === 'monthly' ? (ty - sy) * 12 + tm - sm : ty - sy;
            for (let i = Math.max(0, near - 1); i < 50000 && count < 12; i++) {
                const day = nextOccurrence(r, i);
                if (day < today())
                    continue;
                add(r.id + '-' + day, day, `${r.name} · ¥${(r.amount / 100).toFixed(2)}`);
                count++;
            }
        }
    const [year, month] = today().split('-').map(Number);
    for (const a of l.accounts)
        if (a.kind === 'debt' && a.payDay)
            for (let i = 0; i < 13; i++) {
                const day = isoDate(year, month - 1 + i, a.payDay);
                if (day >= today())
                    add(a.id + '-' + day, day, a.name + '还款日（核对实际账单）');
            }
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Qingji//Ledger//ZH', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n');
}
