import { today, types, type Ledger, type Tx } from './ledger.ts';
import { addDays, isoDate, previousRange, rangeFor, reportTransactions } from './features.ts';
import { hasHKDBalance } from './account-currency.ts';
import { isCurrencyTransfer } from './hk-transfers.ts';

export type ReportPeriod = 'day' | 'week' | 'month' | 'year';
export type ReportDimension = 'category' | 'merchant' | 'account' | 'channel' | 'tags';
export type ReportView = { period: ReportPeriod; anchor: string; dimension: ReportDimension; series: 'expense' | 'income' | 'both'; tab: 'spending' | 'flow'; elapsed: boolean };
export type DateRange = { start: string; end: string };
export const initialReportView = (): ReportView => ({ period: 'month', anchor: today(), dimension: 'category', series: 'expense', tab: 'spending', elapsed: true });
export const validReportDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
export function reportAnchorForMonth(view: ReportView, month: string, asOf = today()) {
    if (!validReportDate(month + '-01') || view.anchor.slice(0, 7) === month) return view.anchor;
    return month === asOf.slice(0, 7) ? asOf : month + '-01';
}
export function shiftReport(period: ReportPeriod, anchor: string, direction: number) {
    const [y, m, d] = anchor.split('-').map(Number);
    return period === 'day' || period === 'week' ? addDays(anchor, direction * (period === 'week' ? 7 : 1)) : isoDate(y + (period === 'year' ? direction : 0), m - 1 + (period === 'month' ? direction : 0), d);
}
export function reportRanges(period: ReportPeriod, anchor: string, elapsed = true, asOf = today()) {
    const full = rangeFor(period, anchor), previous = previousRange(period, anchor);
    const [y, m, d] = anchor.split('-').map(Number), yearAgo = rangeFor(period, isoDate(y - 1, m - 1, d));
    const partial = elapsed && full.start <= asOf && asOf < full.end;
    const days = Math.round((Date.parse(asOf) - Date.parse(full.start)) / 86400000);
    const clip = (r: DateRange) => ({ ...r, end: partial ? [r.end, addDays(r.start, days)].sort()[0] : r.end });
    return { full, range: { ...full, end: partial ? asOf : full.end }, previous: clip(previous), yearAgo: clip(yearAgo), partial };
}
export const isDailyCash = (t: Tx) => t.type === 'expense' || t.type === 'refund' || t.type === 'income';
export const reportRows = (l: Ledger, r: DateRange) => reportTransactions(l).filter(t => t.status === 'posted' && isDailyCash(t) && t.date >= r.start && t.date <= r.end);
/** Statistics may move refunds to the consumption date; exports retain the actual event date. */
export function originalReportRows(l: Ledger, rows: Tx[]) {
    const ids = new Set(rows.map(t => t.id));
    return l.transactions.filter(t => ids.has(t.id));
}
export function cashSummary(rows: Tx[]) {
    let spending = 0, refunds = 0, income = 0;
    for (const t of rows) {
        if (t.status !== 'posted') continue;
        if (t.type === 'expense') spending += t.amount;
        if (t.type === 'refund') refunds += t.amount;
        if (t.type === 'income') income += t.amount;
    }
    return { spending, refunds, netExpense: spending - refunds, income, balance: income - spending + refunds };
}
export function fixedReportRows(l: Ledger, rows: Tx[]) {
    const fixed = new Set(l.transactions.filter(t => t.type === 'expense' && (t.recurrenceKey || t.tags?.includes('固定支出'))).map(t => t.id));
    return rows.filter(t => t.recurrenceKey || t.tags?.includes('固定支出') || t.type === 'refund' && t.original && fixed.has(t.original));
}
export function reportGroups(l: Ledger, rows: Tx[], dimension: ReportDimension) {
    const categories = new Map(l.categories.map(c => [c.id, c.name])), accounts = new Map(l.accounts.map(a => [a.id, a.name]));
    const groups = new Map<string, { key: string; label: string; amount: number; rows: Tx[] }>();
    for (const t of rows) {
        if (t.status !== 'posted' || t.type !== 'expense' && t.type !== 'refund') continue;
        const keys = dimension === 'category' ? [t.category] : dimension === 'account' ? [t.account] : dimension === 'merchant' ? [t.merchant] : dimension === 'channel' ? [t.channel] : t.tags?.length ? [...new Set(t.tags)] : [''];
        for (const key of keys) {
            const label = dimension === 'category' ? categories.get(key) || '未分类' : dimension === 'account' ? accounts.get(key) || '未指定' : key || (dimension === 'tags' ? '无标签' : '未填写');
            const group = groups.get(key) || { key, label, amount: 0, rows: [] };
            group.amount += t.type === 'refund' ? -t.amount : t.amount;
            group.rows.push(t); groups.set(key, group);
        }
    }
    return [...groups.values()].sort((a, b) => b.amount - a.amount);
}
export function reportPoints(rows: Tx[], r: DateRange, period: ReportPeriod) {
    const points = new Map<string, { key: string; label: string; rows: Tx[] }>();
    if (!validReportDate(r.start) || !validReportDate(r.end) || r.start > r.end) return [];
    for (let date = r.start; date <= r.end; date = addDays(date, 1)) {
        const key = period === 'year' ? date.slice(0, 7) : date;
        if (!points.has(key)) points.set(key, { key, label: period === 'year' ? Number(date.slice(5, 7)) + '月' : date.slice(5), rows: [] });
        if (date === r.end) break;
    }
    for (const t of rows) points.get(period === 'year' ? t.date.slice(0, 7) : t.date)?.rows.push(t);
    return [...points.values()].map(p => ({ ...p, summary: cashSummary(p.rows) }));
}

export type FundEntry = { id: string; date: string; account: string; currency: 'CNY' | 'HKD'; amount: number; adjustment: boolean; label: string; counterparty: string };
/** Actual cash movements, independent of refund reporting dates and valuation rates. */
export function fundEntries(l: Ledger): FundEntry[] {
    const accounts = new Map(l.accounts.map(a => [a.id, a])), entries: FundEntry[] = [];
    const add = (id: string, date: string, account: string, currency: 'CNY' | 'HKD', amount: number, label: string, counterparty = '', adjustment = false) => {
        const a = accounts.get(account);
        if (a && hasHKDBalance(a) && amount) entries.push({ id, date, account, currency, amount, label, counterparty, adjustment });
    };
    for (const t of l.transactions) {
        if (t.status !== 'posted') continue;
        const label = t.merchant || types[t.type];
        if (t.type === 'transfer' || t.type === 'repayment') {
            const modern = isCurrencyTransfer(l, t);
            add(t.id + ':out', t.date, t.account, modern ? t.currency! : 'CNY', -t.amount, label, accounts.get(t.to)?.name);
            add(t.id + ':in', t.date, t.to, modern ? t.toCurrency! : 'CNY', modern ? t.toAmount! : t.amount, label, accounts.get(t.account)?.name);
        } else if (t.type === 'adjustment') add(t.id, t.date, t.account, 'CNY', (t.adjustmentSide === 'decrease' ? -1 : 1) * t.amount, label, '', true);
        else add(t.id, t.date, t.account, 'CNY', (t.type === 'expense' ? -1 : 1) * t.amount, label);
    }
    for (const e of l.digital?.events || []) {
        if (e.status === 'posted' && e.fiatAccount && ['buy', 'sell'].includes(e.type)) add('digital:' + e.id, e.date, e.fiatAccount, 'CNY', (e.type === 'buy' ? -1 : 1) * e.fiatCNY, e.type === 'buy' ? '数字资产买入' : '数字资产卖出', l.digital?.assets.find(a => a.id === e.asset)?.symbol);
    }
    for (const e of l.hkSecurities?.events || []) {
        if (e.status !== 'posted' || !e.fiatAccount) continue;
        const hkd = e.fiatCurrency === 'HKD' && e.fiatHKD !== undefined, amount = hkd ? e.fiatHKD : e.fiatCNY;
        if (amount !== undefined) add('hk:' + e.id, e.date, e.fiatAccount, hkd ? 'HKD' : 'CNY', (['deposit', 'buy'].includes(e.type) ? -1 : 1) * amount, '历史证券结算', accounts.get(e.account)?.name);
    }
    return entries;
}
export function fundReport(l: Ledger, range: DateRange) {
    const rows = l.accounts.filter(hasHKDBalance).flatMap(a => (['CNY', 'HKD'] as const).map(currency => ({ account: a.id, name: a.name, currency, opening: currency === 'CNY' ? a.opening : a.openingHKD || 0, inflow: 0, outflow: 0, adjustment: 0, closing: 0, entries: [] as FundEntry[] })));
    const byKey = new Map(rows.map(r => [r.account + '/' + r.currency, r]));
    for (const e of fundEntries(l)) {
        const row = byKey.get(e.account + '/' + e.currency)!;
        if (e.date < range.start) row.opening += e.amount;
        else if (e.date <= range.end) {
            if (e.adjustment) row.adjustment += e.amount;
            else if (e.amount > 0) row.inflow += e.amount;
            else row.outflow -= e.amount;
            row.entries.push(e);
        }
    }
    for (const row of rows) {
        row.closing = row.opening + row.inflow - row.outflow + row.adjustment;
        row.entries.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    }
    return rows;
}
