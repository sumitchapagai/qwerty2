import { AccountService } from '@ghostfolio/api/app/account/account.service';
import { CreateOrderDto } from '@ghostfolio/api/app/order/create-order.dto';
import { Activity } from '@ghostfolio/api/app/order/interfaces/activities.interface';
import { OrderService } from '@ghostfolio/api/app/order/order.service';
import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { ExchangeRateDataService } from '@ghostfolio/api/services/exchange-rate-data.service';
import { SymbolProfileService } from '@ghostfolio/api/services/symbol-profile.service';
import { parseDate } from '@ghostfolio/common/helper';
import { ImportResponse, UniqueAsset } from '@ghostfolio/common/interfaces';
import {
  AccountWithPlatform,
  OrderWithAccount
} from '@ghostfolio/common/types';
import { Injectable } from '@nestjs/common';
import { SymbolProfile } from '@prisma/client';
import Big from 'big.js';
import { endOfToday, isAfter, isSameDay, parseISO } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ImportService {
  public constructor(
    private readonly accountService: AccountService,
    private readonly dataProviderService: DataProviderService,
    private readonly exchangeRateDataService: ExchangeRateDataService,
    private readonly orderService: OrderService,
    private readonly portfolioService: PortfolioService,
    private readonly symbolProfileService: SymbolProfileService
  ) {}

  public async getDividends({
    dataSource,
    symbol,
    userCurrency
  }: UniqueAsset & { userCurrency: string }): Promise<ImportResponse> {
    try {
      const { firstBuyDate, historicalData, orders } =
        await this.portfolioService.getPosition(dataSource, undefined, symbol);

      const accounts = orders.map(({ Account }) => {
        return Account;
      });

      const mostFrequentAccount = this.getMostFrequentAccount(accounts);

      const [[assetProfile], dividends] = await Promise.all([
        this.symbolProfileService.getSymbolProfiles([
          {
            dataSource,
            symbol
          }
        ]),
        await this.dataProviderService.getDividends({
          dataSource,
          symbol,
          from: parseDate(firstBuyDate),
          granularity: 'day',
          to: new Date()
        })
      ]);

      return {
        activities: Object.entries(dividends).map(
          ([dateString, { marketPrice }]) => {
            const quantity =
              historicalData.find((historicalDataItem) => {
                return historicalDataItem.date === dateString;
              })?.quantity ?? 0;

            const value = new Big(quantity).mul(marketPrice).toNumber();

            return {
              quantity,
              value,
              Account: mostFrequentAccount,
              accountId: mostFrequentAccount.id,
              accountUserId: mostFrequentAccount.userId,
              comment: undefined,
              createdAt: undefined,
              date: parseDate(dateString),
              fee: 0,
              feeInBaseCurrency: 0,
              id: assetProfile.id,
              isDraft: false,
              SymbolProfile: <SymbolProfile>(<unknown>assetProfile),
              symbolProfileId: assetProfile.id,
              type: 'DIVIDEND',
              unitPrice: marketPrice,
              updatedAt: undefined,
              userId: mostFrequentAccount.userId,
              valueInBaseCurrency: this.exchangeRateDataService.toCurrency(
                value,
                assetProfile.currency,
                userCurrency
              )
            };
          }
        )
      };
    } catch {
      return { activities: [] };
    }
  }

  public async import({
    activitiesDto,
    isDryRun = false,
    maxActivitiesToImport,
    userCurrency,
    userId
  }: {
    activitiesDto: Partial<CreateOrderDto>[];
    isDryRun?: boolean;
    maxActivitiesToImport: number;
    userCurrency: string;
    userId: string;
  }): Promise<Activity[]> {
    for (const activity of activitiesDto) {
      if (!activity.dataSource) {
        if (activity.type === 'ITEM') {
          activity.dataSource = 'MANUAL';
        } else {
          activity.dataSource = this.dataProviderService.getPrimaryDataSource();
        }
      }
    }

    const assetProfiles = await this.validateActivities({
      activitiesDto,
      maxActivitiesToImport,
      userId
    });

    const accountIds = (await this.accountService.getAccounts(userId)).map(
      (account) => {
        return account.id;
      }
    );

    const activities: Activity[] = [];

    for (const {
      accountId,
      comment,
      currency,
      dataSource,
      date: dateString,
      fee,
      quantity,
      symbol,
      type,
      unitPrice
    } of activitiesDto) {
      const date = parseISO(<string>(<unknown>dateString));
      const validatedAccountId = accountIds.includes(accountId)
        ? accountId
        : undefined;

      let order: OrderWithAccount;

      if (isDryRun) {
        order = {
          comment,
          date,
          fee,
          quantity,
          type,
          unitPrice,
          userId,
          accountId: validatedAccountId,
          accountUserId: undefined,
          createdAt: new Date(),
          id: uuidv4(),
          isDraft: isAfter(date, endOfToday()),
          SymbolProfile: {
            currency,
            dataSource,
            symbol,
            assetClass: null,
            assetSubClass: null,
            comment: null,
            countries: null,
            createdAt: undefined,
            id: undefined,
            name: null,
            scraperConfiguration: null,
            sectors: null,
            symbolMapping: null,
            updatedAt: undefined,
            url: null,
            ...assetProfiles[symbol]
          },
          symbolProfileId: undefined,
          updatedAt: new Date()
        };
      } else {
        order = await this.orderService.createOrder({
          comment,
          date,
          fee,
          quantity,
          type,
          unitPrice,
          userId,
          accountId: validatedAccountId,
          SymbolProfile: {
            connectOrCreate: {
              create: {
                currency,
                dataSource,
                symbol
              },
              where: {
                dataSource_symbol: {
                  dataSource,
                  symbol
                }
              }
            }
          },
          User: { connect: { id: userId } }
        });
      }

      const value = new Big(quantity).mul(unitPrice).toNumber();

      activities.push({
        ...order,
        value,
        feeInBaseCurrency: this.exchangeRateDataService.toCurrency(
          fee,
          currency,
          userCurrency
        ),
        valueInBaseCurrency: this.exchangeRateDataService.toCurrency(
          value,
          currency,
          userCurrency
        )
      });
    }

    return activities;
  }

  private getMostFrequentAccount(accounts: AccountWithPlatform[]) {
    const accountFrequencyCountMap: { [accountId: string]: number } = {};

    // Iterate through the array of accounts and increment the frequency for each account
    for (const account of accounts) {
      accountFrequencyCountMap[account.id] =
        (accountFrequencyCountMap[account.id] || 0) + 1;
    }

    // Find the account with the highest frequency
    let maxFrequencyCount = 0;
    let mostFrequentAccount: AccountWithPlatform;

    for (const accountId in accountFrequencyCountMap) {
      if (accountFrequencyCountMap[accountId] > maxFrequencyCount) {
        mostFrequentAccount = accounts.find(
          (account) => account.id === accountId
        );
        maxFrequencyCount = accountFrequencyCountMap[accountId];
      }
    }

    return mostFrequentAccount;
  }

  private async validateActivities({
    activitiesDto,
    maxActivitiesToImport,
    userId
  }: {
    activitiesDto: Partial<CreateOrderDto>[];
    maxActivitiesToImport: number;
    userId: string;
  }) {
    if (activitiesDto?.length > maxActivitiesToImport) {
      throw new Error(`Too many activities (${maxActivitiesToImport} at most)`);
    }

    const assetProfiles: {
      [symbol: string]: Partial<SymbolProfile>;
    } = {};
    const existingActivities = await this.orderService.orders({
      include: { SymbolProfile: true },
      orderBy: { date: 'desc' },
      where: { userId }
    });

    for (const [
      index,
      { currency, dataSource, date, fee, quantity, symbol, type, unitPrice }
    ] of activitiesDto.entries()) {
      const duplicateActivity = existingActivities.find((activity) => {
        return (
          activity.SymbolProfile.currency === currency &&
          activity.SymbolProfile.dataSource === dataSource &&
          isSameDay(activity.date, parseISO(<string>(<unknown>date))) &&
          activity.fee === fee &&
          activity.quantity === quantity &&
          activity.SymbolProfile.symbol === symbol &&
          activity.type === type &&
          activity.unitPrice === unitPrice
        );
      });

      if (duplicateActivity) {
        throw new Error(`activities.${index} is a duplicate activity`);
      }

      if (dataSource !== 'MANUAL') {
        const assetProfile = (
          await this.dataProviderService.getAssetProfiles([
            { dataSource, symbol }
          ])
        )?.[symbol];

        if (assetProfile === undefined) {
          throw new Error(
            `activities.${index}.symbol ("${symbol}") is not valid for the specified data source ("${dataSource}")`
          );
        }

        if (assetProfile.currency !== currency) {
          throw new Error(
            `activities.${index}.currency ("${currency}") does not match with "${assetProfile.currency}"`
          );
        }

        assetProfiles[symbol] = assetProfile;
      }
    }

    return assetProfiles;
  }
}
