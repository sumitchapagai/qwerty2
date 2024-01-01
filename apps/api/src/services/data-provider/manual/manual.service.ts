import { LookupItem } from '@ghostfolio/api/app/symbol/interfaces/lookup-item.interface';
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { DataProviderInterface } from '@ghostfolio/api/services/data-provider/interfaces/data-provider.interface';
import {
  IDataProviderHistoricalResponse,
  IDataProviderResponse
} from '@ghostfolio/api/services/interfaces/interfaces';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { SymbolProfileService } from '@ghostfolio/api/services/symbol-profile/symbol-profile.service';
import {
  DATE_FORMAT,
  extractNumberFromString,
  getYesterday
} from '@ghostfolio/common/helper';
import { Granularity } from '@ghostfolio/common/types';
import { Injectable, Logger } from '@nestjs/common';
import { DataSource, SymbolProfile } from '@prisma/client';
import * as cheerio from 'cheerio';
import { isUUID } from 'class-validator';
import { addDays, format, isBefore } from 'date-fns';
import got, { Headers } from 'got';
import { ScraperConfiguration } from '@ghostfolio/common/interfaces';
import jsonpath from "jsonpath";

@Injectable()
export class ManualService implements DataProviderInterface {
  public constructor(
    private readonly configurationService: ConfigurationService,
    private readonly prismaService: PrismaService,
    private readonly symbolProfileService: SymbolProfileService
  ) {}

  public canHandle(symbol: string) {
    return true;
  }

  public async getAssetProfile(
    aSymbol: string
  ): Promise<Partial<SymbolProfile>> {
    return {
      dataSource: this.getName(),
      symbol: aSymbol
    };
  }

  public async getDividends({
    from,
    granularity = 'day',
    symbol,
    to
  }: {
    from: Date;
    granularity: Granularity;
    symbol: string;
    to: Date;
  }) {
    return {};
  }

  public async getHistorical(
    aSymbol: string,
    aGranularity: Granularity = 'day',
    from: Date,
    to: Date
  ): Promise<{
    [symbol: string]: { [date: string]: IDataProviderHistoricalResponse };
  }> {
    try {
      const symbol = aSymbol;

      const [symbolProfile] = await this.symbolProfileService.getSymbolProfiles(
        [{ symbol, dataSource: this.getName() }]
      );
      const {
        defaultMarketPrice,
        headers = {},
        selector,
        url
      } = symbolProfile.scraperConfiguration ?? {};

      if (defaultMarketPrice) {
        const historical: {
          [symbol: string]: { [date: string]: IDataProviderHistoricalResponse };
        } = {
          [symbol]: {}
        };
        let date = from;

        while (isBefore(date, to)) {
          historical[symbol][format(date, DATE_FORMAT)] = {
            marketPrice: defaultMarketPrice
          };

          date = addDays(date, 1);
        }

        return historical;
      } else if (selector === undefined || url === undefined) {
        return {};
      }

      const value = await this.scrape(symbolProfile.scraperConfiguration);

      return {
        [symbol]: {
          [format(getYesterday(), DATE_FORMAT)]: {
            marketPrice: value
          }
        }
      };
    } catch (error) {
      throw new Error(
        `Could not get historical market data for ${aSymbol} (${this.getName()}) from ${format(
          from,
          DATE_FORMAT
        )} to ${format(to, DATE_FORMAT)}: [${error.name}] ${error.message}`
      );
    }
  }

  public getName(): DataSource {
    return DataSource.MANUAL;
  }

  public async getQuotes({
    requestTimeout = this.configurationService.get('REQUEST_TIMEOUT'),
    symbols
  }: {
    requestTimeout?: number;
    symbols: string[];
  }): Promise<{ [symbol: string]: IDataProviderResponse }> {
    const response: { [symbol: string]: IDataProviderResponse } = {};

    if (symbols.length <= 0) {
      return response;
    }

    try {
      const symbolProfiles = await this.symbolProfileService.getSymbolProfiles(
        symbols.map((symbol) => {
          return { symbol, dataSource: this.getName() };
        })
      );

      const marketData = await this.prismaService.marketData.findMany({
        distinct: ['symbol'],
        orderBy: {
          date: 'desc'
        },
        take: symbols.length,
        where: {
          symbol: {
            in: symbols
          }
        }
      });

      for (const symbolProfile of symbolProfiles) {
        response[symbolProfile.symbol] = {
          currency: symbolProfile.currency,
          dataSource: this.getName(),
          marketPrice: marketData.find((marketDataItem) => {
            return marketDataItem.symbol === symbolProfile.symbol;
          })?.marketPrice,
          marketState: 'delayed'
        };
      }

      return response;
    } catch (error) {
      Logger.error(error, 'ManualService');
    }

    return {};
  }

  public getTestSymbol() {
    return undefined;
  }

  public async search({
    includeIndices = false,
    query
  }: {
    includeIndices?: boolean;
    query: string;
  }): Promise<{ items: LookupItem[] }> {
    let items = await this.prismaService.symbolProfile.findMany({
      select: {
        assetClass: true,
        assetSubClass: true,
        currency: true,
        dataSource: true,
        name: true,
        symbol: true
      },
      where: {
        OR: [
          {
            dataSource: this.getName(),
            name: {
              mode: 'insensitive',
              startsWith: query
            }
          },
          {
            dataSource: this.getName(),
            symbol: {
              mode: 'insensitive',
              startsWith: query
            }
          }
        ]
      }
    });

    items = items.filter(({ symbol }) => {
      // Remove UUID symbols (activities of type ITEM)
      return !isUUID(symbol);
    });

    return { items };
  }

  public async test(config: ScraperConfiguration) {
    return this.scrape(config);
  }

  private async scrape(config: ScraperConfiguration): Promise<number> {
    try {
      const abortController = new AbortController();

      setTimeout(() => {
        abortController.abort();
      }, this.configurationService.get('REQUEST_TIMEOUT'));


      const { body } = await got(config.url, {
        headers: config.headers as Headers,
        // @ts-ignore
        signal: abortController.signal
      });
      if(config.type === 'json') {
        const data = JSON.parse(body);
        const field = String(jsonpath.query(data, config.selector)[0]);
        return extractNumberFromString(field);
      }
      else{

        const $ = cheerio.load(body);
        return extractNumberFromString($(config.selector).first().text());
      }

    } catch (error) {
      throw error;
    }
  }
}
