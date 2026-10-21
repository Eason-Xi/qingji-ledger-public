import { initial, today, validate, type Ledger, type Tx } from './ledger.ts';
/** Explicitly synthetic examples. This never copies an existing browser ledger. */
export function sampleLedger(): Ledger {
    const ledger = structuredClone(initial), date = today(), now = new Date().toISOString();
    Object.assign(ledger.accounts.find(a => a.id === 'bank')!, { name: '示例银行', opening: 2000000, openingHKD: 100000, hkdToCNY: '0.9', hkdRateAt: now });
    ledger.accounts.push({ id: 'example-bank', name: '示例港币账户', kind: 'asset', opening: 0, region: 'hongkong', hkdToCNY: '0.9', hkdRateAt: now }, { id: 'example-broker', name: '示例证券账户', kind: 'asset', subtype: 'securities', opening: 0 });
    ledger.defaultAccount = 'bank';
    ledger.budget = 600000;
    ledger.hkSecurities = { accounts: [{ id: 'example-broker', openingCashHKD: '0', hkdToCNY: '0.9', hkdToUSD: '0.128', ratesAt: now }], events: [], quotes: [] };
    const row = (id: string, patch: Partial<Tx>): Tx => ({ id: 'example-' + id, type: 'expense', amount: 3200, date, account: 'bank', to: '', channel: '', category: 'c0', merchant: '示例午餐', note: '虚构示例数据，请勿当作真实账目', status: 'posted', tags: ['示例'], ...patch });
    ledger.transactions = [row('salary', { type: 'income', amount: 1800000, category: 'c10', merchant: '示例工资' }), row('rent', { amount: 350000, category: 'c3', merchant: '示例房租', tags: ['示例', '固定支出'] }), row('food', {}), row('shopping', { amount: 12900, category: 'c1', merchant: '示例购物' }), row('exchange', { type: 'transfer', amount: 45000, currency: 'CNY', to: 'example-bank', toCurrency: 'HKD', toAmount: 50000, category: 'c9', merchant: '示例人民币换港币' }), row('broker', { type: 'transfer', account: 'example-bank', to: 'example-broker', amount: 20000, currency: 'HKD', toCurrency: 'HKD', toAmount: 20000, category: 'c9', merchant: '示例银证转账' })];
    validate(ledger);
    return ledger;
}
