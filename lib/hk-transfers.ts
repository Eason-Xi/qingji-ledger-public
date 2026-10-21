import type { Ledger, Tx } from './ledger.ts';
import { hasHKDBalance } from './account-currency.ts';

export const isHKTransfer = (l: Ledger, t: Pick<Tx, 'type' | 'account' | 'to'>) => t.type === 'transfer' && !!l.hkSecurities?.accounts.some(a => a.id === t.account || a.id === t.to);
export const isCurrencyTransfer = (l: Ledger, t: Tx) => t.type === 'transfer' && (isHKTransfer(l, t) || t.currency === 'HKD' || t.toCurrency !== undefined || t.toAmount !== undefined);

export function validateHKTransfer(l: Ledger, t: Tx) {
    const source = l.accounts.find(a => a.id === t.account), target = l.accounts.find(a => a.id === t.to);
    const hk = new Set(l.hkSecurities?.accounts.map(a => a.id));
    if (!source || !target || source.kind !== 'asset' || target.kind !== 'asset' || t.account === t.to || hk.has(t.account) === hk.has(t.to)) throw Error('银证转账请选择一个银行资金账户和一个港股证券账户');
    if ((!hk.has(source.id) && source.subtype === 'securities') || (!hk.has(target.id) && target.subtype === 'securities')) throw Error('银证转账的另一方请选择普通银行资金账户');
    for (const [account, currency] of [[source, t.currency], [target, t.toCurrency]] as const) {
        if (!['CNY', 'HKD'].includes(currency || '') || (hk.has(account.id) ? currency !== 'HKD' : currency === 'HKD' && !hasHKDBalance(account))) throw Error('证券账户使用港币，银行资金账户可选人民币或港币');
    }
    if (!Number.isSafeInteger(t.toAmount) || t.toAmount! <= 0 || t.toAmount! > 100000000000) throw Error('请填写实际到账金额');
    if (t.fee || t.feeParent) throw Error('银证转账请填写含费用的实际扣款和到账金额');
}

export function validateCurrencyTransfer(l: Ledger, t: Tx) {
    if (!Number.isSafeInteger(t.amount) || t.amount <= 0 || t.amount > 100000000000) throw Error('请填写有效的实际扣款金额');
    if (isHKTransfer(l, t)) return validateHKTransfer(l, t);
    const source = l.accounts.find(a => a.id === t.account), target = l.accounts.find(a => a.id === t.to);
    if (!source || !target || !hasHKDBalance(source) || !hasHKDBalance(target) || source.id === target.id) throw Error('人民币/港币转账请选择两个不同的银行资金账户');
    if (![t.currency, t.toCurrency].every(c => c === 'CNY' || c === 'HKD')) throw Error('转账币种请选择人民币或港币');
    if (!Number.isSafeInteger(t.toAmount) || t.toAmount! <= 0 || t.toAmount! > 100000000000) throw Error('请填写实际到账金额');
    if (t.fee || t.feeParent) throw Error('请填写含费用的实际扣款和到账金额');
}

function exchangeRate(t: Tx) {
    if (t.currency === t.toCurrency) return undefined;
    const cny = t.currency === 'CNY' ? t.amount : t.toAmount!, hkd = t.currency === 'HKD' ? t.amount : t.toAmount!;
    const scaled = (BigInt(cny) * 100000000n + BigInt(hkd) / 2n) / BigInt(hkd);
    return `${scaled / 100000000n}.${String(scaled % 100000000n).padStart(8, '0')}`;
}

export function transferNeedsRate(l: Ledger, t: Tx) {
    if (!isCurrencyTransfer(l, t) || t.currency !== 'HKD' && t.toCurrency !== 'HKD' || isHKTransfer(l, t) || t.currency !== t.toCurrency) return false;
    const banks = l.accounts.filter(a => a.id === t.account || a.id === t.to);
    return !banks.some(a => a.hkdToCNY && a.hkdRateAt);
}

/** Save the bank's valuation rate when its first HKD transfer is recorded. */
export function hkTransferAccounts(l: Ledger, t: Tx, manualRate?: string) {
    if (!isCurrencyTransfer(l, t)) return l.accounts;
    validateCurrencyTransfer(l, t);
    const broker = l.hkSecurities?.accounts.find(a => a.id === t.account || a.id === t.to);
    const donor = l.accounts.find(a => (a.id === t.account || a.id === t.to) && a.hkdToCNY && a.hkdRateAt);
    const rate = manualRate || broker?.hkdToCNY || exchangeRate(t) || donor?.hkdToCNY;
    const at = manualRate ? new Date().toISOString() : broker?.ratesAt || (t.currency !== t.toCurrency ? new Date().toISOString() : donor?.hkdRateAt);
    return l.accounts.map(a => ((a.id === t.account && t.currency === 'HKD') || (a.id === t.to && t.toCurrency === 'HKD')) && hasHKDBalance(a)
        ? { ...a, hkdToCNY: a.hkdToCNY || rate, hkdRateAt: a.hkdRateAt || at } : a);
}
