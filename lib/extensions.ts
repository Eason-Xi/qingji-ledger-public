export type Category = {
    id: string;
    name: string;
    parent?: string;
    active?: boolean;
    order?: number;
    mergedInto?: string;
};
export type RecurringRule = {
    id: string;
    name: string;
    amount: number;
    type: 'expense' | 'income';
    account: string;
    category: string;
    channel: string;
    start: string;
    frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
    active: boolean;
    autoDraft: boolean;
    tags: string[];
};
export type MerchantRule = {
    id: string;
    match: string;
    category: string;
    account?: string;
    channel?: string;
};
export type Preferences = {
    cards: string[];
    /** Legacy backup field; recognized entries now always wait for review. */
    autoPost: boolean;
    cloudAI: boolean;
    retainInput: boolean;
    refundMode: 'occurrence' | 'original';
    offline: boolean;
    costMethod: '' | 'average' | 'fifo';
    digitalEnabled: boolean;
    securitiesEnabled: boolean;
};
export const cardNames: Record<string, string> = { summary: '收支概览', compose: '一句话记账', recent: '最近流水', reminders: '账单提醒', budget: '本月预算', categories: '支出分类', accounts: '账户概览' };
export const defaultPreferences: Preferences = { cards: Object.keys(cardNames), autoPost: false, cloudAI: false, retainInput: true, refundMode: 'occurrence', offline: false, costMethod: '', digitalEnabled: false, securitiesEnabled: false };
export type DigitalWallet = {
    id: string;
    name: string;
    kind: 'exchange' | 'wallet';
    network: string;
    address?: string;
    chainProvider?: 'bitcoin' | 'tron' | 'ethereum';
};
export type DigitalAsset = {
    id: string;
    symbol: string;
    name: string;
    network: string;
    priceId: string;
    chainProvider?: 'bitcoin' | 'tron' | 'ethereum';
    tokenContract?: string;
};
export type DigitalEvent = {
    id: string;
    type: 'opening' | 'buy' | 'sell' | 'transfer' | 'swap' | 'income' | 'fee';
    date: string;
    time?: string;
    created: string;
    wallet: string;
    asset: string;
    quantity: string;
    toWallet?: string;
    toAsset?: string;
    toQuantity?: string;
    fiatCNY: number;
    fiatAccount?: string;
    feeAsset?: string;
    feeQuantity?: string;
    txHash: string;
    note: string;
    status: 'posted' | 'deleted';
};
export type DigitalBalance = {
    id: string;
    wallet: string;
    asset: string;
    quantity: string;
    updated: string;
    note: string;
};
export type DigitalBook = {
    wallets: DigitalWallet[];
    assets: DigitalAsset[];
    events: DigitalEvent[];
    manualBalances?: DigitalBalance[];
    marketWatchlist?: MarketCoin[];
    marketDefaultsVersion?: 1;
    quotes: Record<string, {
        priceCNY: string;
        source: string;
        at: string;
    }>;
};
export type MarketCoin = { symbol: string; name: string; priceId: string };
export type LedgerExtensions = {
    hkSecurities?: HKBook;
    recurring?: RecurringRule[];
    merchantRules?: MerchantRule[];
    monthlyBudgets?: Record<string, number>;
    categoryBudgets?: Record<string, Record<string, number>>;
    preferences?: Partial<Preferences>;
    digital?: DigitalBook;
};
export type HKAccount = { id: string; openingCashHKD: string; hkdToCNY: string; hkdToUSD: string; ratesAt: string };
export type HKEvent = {
    id: string; account: string; type: 'opening' | 'buy' | 'sell' | 'deposit' | 'withdrawal' | 'dividend' | 'fee';
    symbol: string; name: string; quantity: number; priceHKD: string; feesHKD: string; amountHKD: string;
    date: string; time: string; created: string; note: string; status: 'posted' | 'deleted';
    fiatAccount?: string; fiatCNY?: number; fiatCurrency?: 'CNY' | 'HKD'; fiatHKD?: number;
};
export type HKQuote = { id: string; priceHKD: string; date: string };
export type HKBook = { accounts: HKAccount[]; events: HKEvent[]; quotes: HKQuote[] };
