import type { Ledger } from './ledger.ts';
import { marketWatchlist } from './market-watchlist.ts';

export type OptionalModule = 'digital' | 'securities';
const preferenceKeys = { digital: 'digitalEnabled', securities: 'securitiesEnabled' } as const;

/** Legacy and new books both start with optional modules hidden. */
export function moduleEnabled(ledger: Ledger, module: OptionalModule) {
    return ledger.preferences?.[preferenceKeys[module]] === true;
}

/** Change visibility only; financial records and saved valuations stay intact. */
export function setModuleEnabled(ledger: Ledger, module: OptionalModule, enabled: boolean): Ledger {
    return { ...ledger, preferences: { ...ledger.preferences, [preferenceKeys[module]]: enabled } };
}

export function modulePageEnabled(ledger: Ledger, page: number) {
    return page === 4 ? moduleEnabled(ledger, 'digital') : page === 5 ? moduleEnabled(ledger, 'securities') : true;
}

export function homeMarketSelection(ledger: Ledger) {
    if (!moduleEnabled(ledger, 'digital') || !ledger.digital) return [];
    const held = new Set(ledger.digital.assets.map(asset => asset.symbol.trim().toUpperCase()));
    return marketWatchlist(ledger.digital).filter(coin => held.has(coin.symbol));
}
