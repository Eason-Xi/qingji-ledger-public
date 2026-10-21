import type { Account, Ledger } from './ledger.ts';
export const accountRegion = (a: Account) => a.region || (typeof a.name === 'string' && /香港|hong\s*kong|\bhk\b/i.test(a.name) ? 'hongkong' : 'mainland');
export const hasHKDBalance = (a: Account) => a.kind === 'asset' && a.subtype !== 'securities';
export const hasHKDSettings = (a: Account) => hasHKDBalance(a) && (!!a.openingHKD || a.hkdToCNY !== undefined || accountRegion(a) === 'hongkong');
export function validateAccountCurrencies(l: Ledger) {
    for (const a of l.accounts) {
        if (a.region !== undefined && !['mainland', 'hongkong'].includes(a.region)) throw Error('账户地区无效');
        if (a.openingHKD !== undefined && (!Number.isSafeInteger(a.openingHKD) || Math.abs(a.openingHKD) > 100000000000)) throw Error('港币期初余额无效');
        if (a.hkdToCNY !== undefined && (typeof a.hkdToCNY !== 'string' || a.hkdToCNY.length > 24 || !/^\d+(?:\.\d{1,8})?$/.test(a.hkdToCNY) || Number(a.hkdToCNY) <= 0 || Number(a.hkdToCNY) > 100)) throw Error('银行港币折算汇率无效');
        if (a.hkdRateAt !== undefined && (typeof a.hkdRateAt !== 'string' || !Number.isFinite(Date.parse(a.hkdRateAt)))) throw Error('银行汇率日期无效');
        if ((a.hkdToCNY !== undefined) !== (a.hkdRateAt !== undefined)) throw Error('银行折算汇率和日期需同时填写');
        if ((a.openingHKD || a.hkdToCNY !== undefined || a.hkdRateAt !== undefined) && !hasHKDBalance(a)) throw Error('普通银行及资金账户可记录港币余额');
        if ((a.openingHKD || l.hkSecurities?.events.some(e => e.fiatAccount === a.id && e.fiatCurrency === 'HKD') || l.transactions.some(t => t.account === a.id && t.currency === 'HKD' || t.to === a.id && t.toCurrency === 'HKD')) && hasHKDBalance(a) && (!a.hkdToCNY || !a.hkdRateAt)) throw Error('请填写银行港币兑人民币的折算汇率和日期');
    }
}
