import {
  Account,
  AssetClass,
  AssetSubClass,
  DataSource,
  SymbolProfile
} from '@prisma/client';

import { OrderType } from '../../models/order-type';

export const MarketState = {
  closed: 'closed',
  delayed: 'delayed',
  open: 'open'
};

export interface IOrder {
  account: Account;
  currency: string;
  date: string;
  fee: number;
  id?: string;
  isDraft: boolean;
  quantity: number;
  symbol: string;
  symbolProfile: SymbolProfile;
  type: OrderType;
  unitPrice: number;
}

export interface IDataProviderHistoricalResponse {
  marketPrice: number;
  performance?: number;
}

export interface IDataProviderResponse {
  assetClass?: AssetClass;
  assetSubClass?: AssetSubClass;
  countries?: { code: string; weight: number }[];
  currency: string;
  dataSource: DataSource;
  exchange?: string;
  marketChange?: number;
  marketChangePercent?: number;
  marketPrice: number;
  marketState: MarketState;
  name?: string;
  sectors?: { name: string; weight: number }[];
  url?: string;
}

export interface IDataGatheringItem {
  dataSource: DataSource;
  date?: Date;
  symbol: string;
}

export type MarketState = typeof MarketState[keyof typeof MarketState];
