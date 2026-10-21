import type { HKBook, HKEvent } from './extensions.ts';
import { hasHKDBalance } from './account-currency.ts';
import type { Ledger, Tx } from './ledger.ts';

export const hkEventNames = { opening: '已有持仓', buy: '买入', sell: '卖出', deposit: '入金', withdrawal: '出金', dividend: '现金股息', fee: '其他费用' };
export const emptyHK = (): HKBook => ({ accounts: [], events: [], quotes: [] });
export const isHKAccount = (l: Ledger, id: string) => !!l.hkSecurities?.accounts.some(a => a.id === id);
export const isStockEvent = (type: HKEvent['type']) => ['opening', 'buy', 'sell'].includes(type);
export function hkSettlementAccounts(l: Ledger, event: HKEvent) {
    if (event.fiatCurrency !== 'HKD') return l.accounts;
    const bank = l.accounts.find(a => a.id === event.fiatAccount);
    if (!bank || !hasHKDBalance(bank)) throw Error('港币结算需选择银行资金账户');
    if (bank.hkdToCNY && bank.hkdRateAt) return l.accounts;
    const config = l.hkSecurities?.accounts.find(a => a.id === event.account);
    if (!config) throw Error('证券账户汇率不存在');
    return l.accounts.map(a => a.id === bank.id ? { ...a, hkdToCNY: bank.hkdToCNY || config.hkdToCNY, hkdRateAt: bank.hkdRateAt || config.ratesAt } : a);
}
export function hkCode(value: string) {
    const code = value.trim().replace(/\.HK$/i, '');
    if (!/^\d{1,5}$/.test(code) || Number(code) === 0) throw Error('港股代码需为 1 至 5 位数字，例如 00700');
    return code.padStart(5, '0');
}
export function hkUnits(value: string, digits = 2): bigint {
    if (typeof value !== 'string' || value.length > 24 || !new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`).test(value))
        throw Error(`金额格式无效，最多 ${digits} 位小数`);
    const [a, b = ''] = value.split('.');
    const n = BigInt(a) * 10n ** BigInt(digits) + BigInt(b.padEnd(digits, '0'));
    if (n > 10000000000n * 10n ** BigInt(digits)) throw Error('金额超出范围');
    return n;
}
const round = (n: bigint, d: bigint): bigint => n < 0n ? -round(-n, d) : (n + d / 2n) / d;
const safe = (n: bigint) => { if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER)) throw Error('合计金额超出范围'); return Number(n); };
export const hkTradeAmount = (price: string, quantity: number) => safe(round(hkUnits(price, 4) * BigInt(quantity), 100n));
export const hkConvert = (cents: number, rate: string) => safe(round(BigInt(cents) * hkUnits(rate, 8), 100000000n));
const validDate = (s: string) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const text = (s: unknown, max: number) => typeof s === 'string' && s.length <= max;

export function hkPortfolio(book: HKBook, transactions: Tx[] = []) {
    const accounts = new Map(book.accounts.map(a => [a.id, { id: a.id, cash: hkUnits(a.openingCashHKD), cost: 0n, value: 0n, realized: 0n, missing: 0 }]));
    for (const t of transactions) {
        if (t.type !== 'transfer' || t.status !== 'posted') continue;
        const source = accounts.get(t.account), target = accounts.get(t.to);
        if (source) source.cash -= BigInt(t.amount);
        if (target) target.cash += BigInt(t.toAmount!);
    }
    const positions = new Map<string, { account: string; symbol: string; name: string; quantity: number; cost: bigint; realized: bigint }>();
    const events = book.events.filter(e => e.status === 'posted').sort((a, b) => (a.date + (a.time || '00:00')).localeCompare(b.date + (b.time || '00:00')) || a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
    for (const e of events) {
        const account = accounts.get(e.account);
        if (!account) throw Error('港股记录的账户不存在');
        if (!isStockEvent(e.type)) {
            account.cash += (['withdrawal', 'fee'].includes(e.type) ? -1n : 1n) * hkUnits(e.amountHKD);
            continue;
        }
        const key = `${e.account}/${e.symbol}`;
        const p = positions.get(key) || { account: e.account, symbol: e.symbol, name: e.name, quantity: 0, cost: 0n, realized: 0n };
        p.name = e.name;
        const gross = BigInt(hkTradeAmount(e.priceHKD, e.quantity)), fees = hkUnits(e.feesHKD);
        if (e.type === 'sell') {
            if (e.quantity > p.quantity) throw Error(`${e.date} ${e.symbol} 卖出数量超过当时持仓，请核对买入日期、数量和记录顺序`);
            const removed = e.quantity === p.quantity ? p.cost : round(p.cost * BigInt(e.quantity), BigInt(p.quantity));
            p.quantity -= e.quantity;
            p.cost -= removed;
            const realized = gross - fees - removed;
            p.realized += realized;
            account.realized += realized;
            if (!e.fiatAccount) account.cash += gross - fees;
        } else {
            p.quantity += e.quantity;
            if (!Number.isSafeInteger(p.quantity) || p.quantity > 1000000000) throw Error('持仓股数超出范围');
            p.cost += gross + fees;
            if (e.type === 'buy' && !e.fiatAccount) account.cash -= gross + fees;
        }
        positions.set(key, p);
    }
    const quotes = new Map(book.quotes.map(q => [q.id, q]));
    const holdings = [...positions.values()].filter(p => p.quantity > 0).map(p => {
        const quote = quotes.get(p.symbol), value = quote ? BigInt(hkTradeAmount(quote.priceHKD, p.quantity)) : p.cost;
        const account = accounts.get(p.account)!;
        account.cost += p.cost;
        account.value += value;
        if (!quote) account.missing++;
        return { ...p, cost: safe(p.cost), realized: safe(p.realized), value: safe(value), average: Number(p.cost) / 100 / p.quantity, unrealized: quote ? safe(value - p.cost) : null, quote };
    });
    return { holdings, accounts: book.accounts.map(config => {
        const a = accounts.get(config.id)!;
        const total = safe(a.cash + a.value);
        return { id: a.id, cash: safe(a.cash), cost: safe(a.cost), value: safe(a.value), total, realized: safe(a.realized), missing: a.missing, cny: hkConvert(total, config.hkdToCNY), usd: hkConvert(total, config.hkdToUSD) };
    }) };
}

export function validateHK(l: Ledger) {
    const b = l.hkSecurities;
    if (!b) return;
    if (!Array.isArray(b.accounts) || !Array.isArray(b.events) || !Array.isArray(b.quotes) || b.accounts.length > 100 || b.events.length > 10000 || b.quotes.length > 1000) throw Error('港股账本格式或容量无效');
    for (const rows of [b.accounts, b.events, b.quotes])
        if (rows.some(r => !r || !text(r.id, 200) || !r.id) || new Set(rows.map(r => r.id)).size !== rows.length) throw Error('港股账本 ID 无效或重复');
    const ids = new Set(b.accounts.map(a => a.id));
    for (const a of b.accounts) {
        const parent = l.accounts.find(p => p.id === a.id);
        if (parent?.kind !== 'asset' || parent.subtype !== 'securities' || parent.opening !== 0) throw Error('港股账户需使用独立的港币现金和持仓，不可同时填写人民币期初余额');
        hkUnits(a.openingCashHKD);
        for (const rate of [a.hkdToCNY, a.hkdToUSD]) if (hkUnits(rate, 8) <= 0n || hkUnits(rate, 8) > 10000000000n) throw Error('请填写有效的港币折算汇率');
        if (!text(a.ratesAt, 50) || !Number.isFinite(Date.parse(a.ratesAt))) throw Error('汇率日期无效');
    }
    if (ids.has(l.defaultAccount) || Object.values(l.channels).some(id => ids.has(id)) || l.transactions.some(t => t.type !== 'transfer' && (ids.has(t.account) || ids.has(t.to))) || l.recurring?.some(r => ids.has(r.account)) || l.merchantRules?.some(r => r.account && ids.has(r.account)) || l.digital?.events.some(e => e.fiatAccount && ids.has(e.fiatAccount)))
        throw Error('港股账户仅可在日常账本中进行银证转账；日常账本收支使用人民币资金账户');
    for (const q of b.quotes) {
        if (hkCode(q.id) !== q.id || !validDate(q.date)) throw Error('港股现价的代码或日期无效');
        hkUnits(q.priceHKD, 4);
    }
    for (const e of b.events) {
        if (!ids.has(e.account) || !Object.hasOwn(hkEventNames, e.type) || !['posted', 'deleted'].includes(e.status) || !validDate(e.date) || !text(e.time, 5) || e.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(e.time) || !text(e.created, 50) || !Number.isFinite(Date.parse(e.created)) || !text(e.note, 2000) || !text(e.name, 100) || !text(e.symbol, 5)) throw Error('港股交易记录格式无效');
        if (isStockEvent(e.type)) {
            if (hkCode(e.symbol) !== e.symbol || !e.name.trim() || !Number.isSafeInteger(e.quantity) || e.quantity <= 0 || e.quantity > 1000000000 || hkUnits(e.priceHKD, 4) <= 0n) throw Error('请填写港股代码、名称、正整数股数和有效单价');
            hkUnits(e.feesHKD);
            if (e.type === 'sell' && e.fiatAccount && BigInt(hkTradeAmount(e.priceHKD, e.quantity)) <= hkUnits(e.feesHKD)) throw Error('银行结算的卖出净额必须大于零');
        } else {
            if (hkUnits(e.amountHKD) <= 0n) throw Error('港币金额必须大于零');
        }
        if (e.fiatCurrency !== undefined && !['CNY', 'HKD'].includes(e.fiatCurrency)) throw Error('银行结算币种无效');
        if (e.fiatAccount) {
            const fiat = l.accounts.find(a => a.id === e.fiatAccount);
            const hkd = e.fiatCurrency === 'HKD', actual = hkd ? e.fiatHKD : e.fiatCNY;
            if (!['buy', 'sell', 'deposit', 'withdrawal'].includes(e.type) || fiat?.kind !== 'asset' || ids.has(e.fiatAccount) || !Number.isSafeInteger(actual) || actual! <= 0 || actual! > 100000000000) throw Error('关联的银行账户或实际结算金额无效');
            if (hkd && (!hasHKDBalance(fiat!) || e.fiatCNY !== undefined)) throw Error('港币结算需选择银行资金账户，且不能同时填写人民币扣款');
            if (!hkd && e.fiatHKD !== undefined) throw Error('人民币结算不可同时填写港币扣款');
        } else if (e.fiatCNY !== undefined || e.fiatHKD !== undefined || e.fiatCurrency !== undefined) throw Error('请先选择关联的银行账户');
    }
    hkPortfolio(b);
}
