import type { Tx } from './ledger.ts';
export type BookDrafts = { text: string; rows: Tx[]; warnings: string[]; reviewed: string[]; transferRates?: Record<string, string> };
export const emptyBookDrafts = (): BookDrafts => ({ text: '', rows: [], warnings: [], reviewed: [] });
