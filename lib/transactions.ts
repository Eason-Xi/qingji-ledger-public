import { newId } from './ids.ts';
import { paymentChannels, resolveChannel } from './channels.ts';
import { cents, validate, type Ledger, type Tx } from './ledger.ts';
import { hkTransferAccounts } from './hk-transfers.ts';
export function splitExpense(l: Ledger, id: string, parts: {
    amount: string;
    category: string;
    merchant: string;
}[]): Ledger {
    const original = l.transactions.find(t => t.id === id && t.status === 'posted' && t.type === 'expense');
    if (!original)
        throw Error('只能拆分已入账的支出');
    if (parts.length < 2 || parts.length > 20)
        throw Error('请拆分为 2 至 20 笔');
    if (l.transactions.some(t => t.status === 'posted' && t.type === 'refund' && t.original === id))
        throw Error('这笔消费已关联退款，请先处理退款后再拆分');
    const children: Tx[] = parts.map(p => ({ ...original, id: newId(), amount: cents(p.amount), category: p.category, merchant: p.merchant.trim() || original.merchant, splitGroup: id, externalId: undefined, note: [original.note, '拆分自 ' + id].filter(Boolean).join('\n') }));
    if (children.reduce((s, t) => s + t.amount, 0) !== original.amount)
        throw Error('拆分金额合计必须等于原消费金额');
    const next = { ...l, transactions: [...l.transactions.map(t => t.id === id ? { ...t, status: 'deleted' as const } : t), ...children] };
    validate(next);
    return next;
}
export function bulkUpdate(l: Ledger, ids: Set<string>, patch: {
    category?: string;
    tags?: string[];
    status?: Tx['status'];
}): Ledger {
    if (!ids.size)
        throw Error('请先选择流水');
    const affected = new Set(ids);
    if (patch.status)
        for (const t of l.transactions)
            if (t.feeParent && ids.has(t.feeParent))
                affected.add(t.id);
    const next = { ...l, transactions: l.transactions.map(t => affected.has(t.id) ? { ...t, ...patch } : t) };
    validate(next);
    return next;
}
/** Explicit approval changes pending rows only; linked pending fees follow their parent. */
export function approvePending(l: Ledger, ids: Set<string>, at = new Date().toISOString()) {
    const byId = new Map(l.transactions.map(t => [t.id, t]));
    const accounts = new Map(l.accounts.map(a => [a.id, a]));
    const channelKey = (s: string) => s.normalize('NFKC').trim().toLowerCase();
    const stoppedChannels = new Set(paymentChannels(l).filter(c => !c.active).flatMap(c => [c.name, ...c.aliases].map(channelKey)));
    const affected = new Set(l.transactions.filter(t => ids.has(t.id) && t.status === 'pending').map(t => t.id));
    if (!affected.size) throw Error('当前范围没有待确认记录');
    for (const t of l.transactions) {
        if (affected.has(t.id) && t.feeParent && byId.get(t.feeParent)?.status !== 'posted' && !affected.has(t.feeParent))
            throw Error('请同时选择手续费对应的转账或还款记录');
    }
    for (const t of l.transactions)
        if (t.status === 'pending' && t.feeParent && affected.has(t.feeParent)) affected.add(t.id);
    const next = { ...l, transactions: l.transactions.map(t => {
        if (!affected.has(t.id)) return t;
        const prefix = `${t.merchant || '此记录'}：`;
        if (accounts.get(t.account)?.active === false || (t.to && accounts.get(t.to)?.active === false))
            throw Error(prefix + '资金账户已停用，请先修改账户');
        if (t.channel && stoppedChannels.has(channelKey(t.channel)))
            throw Error(prefix + '支付渠道已停用，请先修改渠道');
        if (['transfer', 'repayment'].includes(t.type) && (!t.to || t.to === t.account))
            throw Error(prefix + '请补全不同的转出和转入账户');
        if (t.type === 'refund' && !t.original) throw Error(prefix + '请关联原支出');
        return { ...t, status: 'posted' as const, updatedAt: at };
    }) };
    validate(next);
    return { ledger: next, count: affected.size };
}
export function approveDrafts(l: Ledger, drafts: Tx[], transferRates: Record<string, string> = {}) {
    if (!drafts.length) throw Error('没有待审核的识别结果');
    if (drafts.some(t => t.status === 'deleted' || l.transactions.some(saved => saved.id === t.id)))
        throw Error('识别结果已保存或已删除，请重新识别');
    let next = l;
    for (const t of drafts) next = upsertTransaction(next, { ...t, status: 'pending' }, t.fee, transferRates[t.id]);
    return approvePending(next, new Set(drafts.map(t => t.id)));
}
export function ledgerRows(l: Ledger, transactions: Tx[]) { const account = (id: string) => l.accounts.find(a => a.id === id)?.name || ''; const names = { expense: '支出', income: '收入', transfer: '内部转账', repayment: '信用卡还款', refund: '退款', adjustment: '余额调整' }; return [['日期', '收支类型', '金额', '资金账户', '转入账户', '分类', '商户', '支付渠道', '备注', '外部流水号', '币种', '标签', '发生时间', '时区', '原消费流水号', '余额调整方向', '到账金额', '到账币种'], ...transactions.filter(t => t.status === 'posted').map(t => [t.date, names[t.type], (t.amount / 100).toFixed(2), account(t.account), account(t.to), l.categories.find(c => c.id === t.category)?.name || '', t.merchant, t.channel, t.note, t.externalId || t.id, t.currency || 'CNY', (t.tags || []).join('、'), t.time || '', t.timezone || 'Asia/Shanghai', t.original ? (l.transactions.find(x => x.id === t.original)?.externalId || t.original) : '', t.adjustmentSide || '', t.toAmount === undefined ? '' : (t.toAmount / 100).toFixed(2), t.toCurrency || ''])]; }
export function upsertTransaction(l: Ledger, t: Tx, fee: number | undefined, valuationRate?: string): Ledger {
    const canonical = t.channel ? resolveChannel(l, t.channel) : undefined;
    if (canonical)
        t = { ...t, channel: canonical.name };
    let rows = l.transactions.some(x => x.id === t.id) ? l.transactions.map(x => x.id === t.id ? t : x) : [...l.transactions, t];
    if (fee !== undefined) {
        const old = rows.find(x => x.feeParent === t.id);
        if (fee > 0) {
            const entry: Tx = { id: old?.id || newId(), type: 'expense', amount: fee, date: t.date, account: t.account, to: '', channel: t.channel, category: l.categories.find(c => c.id === 'c9')?.id || t.category, merchant: '转账手续费', note: '关联 ' + t.merchant, status: t.status, feeParent: t.id, createdAt: old?.createdAt || new Date().toISOString() };
            rows = old ? rows.map(x => x.id === old.id ? entry : x) : [...rows, entry];
        }
        else if (old)
            rows = rows.map(x => x.id === old.id ? { ...x, status: 'deleted' } : x);
    }
    const next = { ...l, accounts: hkTransferAccounts(l, t, valuationRate), transactions: rows };
    validate(next);
    return next;
}
export function transactionPostings(l: Ledger) {
    const entries: {
        transaction: string;
        date: string;
        account: string;
        direction: 'debit' | 'credit';
        amount: number;
        currency?: 'CNY' | 'HKD';
    }[] = [];
    for (const t of l.transactions.filter(t => t.status === 'posted')) {
        const add = (account: string, direction: 'debit' | 'credit', amount = t.amount, currency = t.currency) => entries.push({ transaction: t.id, date: t.date, account, direction, amount, ...(currency ? { currency } : {}) });
        if (t.type === 'expense') {
            add(t.account, 'credit');
            add('expense:' + t.category, 'debit');
        }
        else if (t.type === 'income') {
            add(t.account, 'debit');
            add('income:' + t.category, 'credit');
        }
        else if (t.type === 'refund') {
            add(t.account, 'debit');
            add('expense:' + t.category, 'credit');
        }
        else if (t.type === 'transfer' || t.type === 'repayment') {
            add(t.account, 'credit');
            add(t.to, 'debit', t.toAmount ?? t.amount, t.toCurrency);
        }
        else {
            const debt = l.accounts.find(a => a.id === t.account)?.kind === 'debt';
            const dir = (t.adjustmentSide === 'increase') !== debt ? 'debit' : 'credit';
            add(t.account, dir);
            add('equity:adjustment', dir === 'debit' ? 'credit' : 'debit');
        }
    }
    return entries;
}
