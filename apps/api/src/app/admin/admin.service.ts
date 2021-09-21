import { SubscriptionService } from '@ghostfolio/api/app/subscription/subscription.service';
import { ConfigurationService } from '@ghostfolio/api/services/configuration.service';
import { DataGatheringService } from '@ghostfolio/api/services/data-gathering.service';
import { ExchangeRateDataService } from '@ghostfolio/api/services/exchange-rate-data.service';
import { PrismaService } from '@ghostfolio/api/services/prisma.service';
import { AdminData } from '@ghostfolio/common/interfaces';
import { Injectable } from '@nestjs/common';
import { differenceInDays } from 'date-fns';

@Injectable()
export class AdminService {
  public constructor(
    private readonly configurationService: ConfigurationService,
    private readonly dataGatheringService: DataGatheringService,
    private readonly exchangeRateDataService: ExchangeRateDataService,
    private readonly prismaService: PrismaService,
    private readonly subscriptionService: SubscriptionService
  ) {}

  public async get(): Promise<AdminData> {
    return {
      exchangeRates: [
        {
          label1: 'EUR',
          label2: 'CHF',
          value: await this.exchangeRateDataService.toCurrency(1, 'EUR', 'CHF')
        },
        {
          label1: 'GBP',
          label2: 'CHF',
          value: await this.exchangeRateDataService.toCurrency(1, 'GBP', 'CHF')
        },
        {
          label1: 'USD',
          label2: 'CHF',
          value: await this.exchangeRateDataService.toCurrency(1, 'USD', 'CHF')
        },
        {
          label1: 'USD',
          label2: 'EUR',
          value: await this.exchangeRateDataService.toCurrency(1, 'USD', 'EUR')
        },
        {
          label1: 'USD',
          label2: 'GBP',
          value: await this.exchangeRateDataService.toCurrency(1, 'USD', 'GBP')
        }
      ],
      lastDataGathering: await this.getLastDataGathering(),
      transactionCount: await this.prismaService.order.count(),
      userCount: await this.prismaService.user.count(),
      users: await this.getUsersWithAnalytics()
    };
  }

  private async getLastDataGathering() {
    const lastDataGathering =
      await this.dataGatheringService.getLastDataGathering();

    if (lastDataGathering) {
      return lastDataGathering;
    }

    const dataGatheringInProgress =
      await this.dataGatheringService.getIsInProgress();

    if (dataGatheringInProgress) {
      return 'IN_PROGRESS';
    }

    return null;
  }

  private async getUsersWithAnalytics(): Promise<AdminData['users']> {
    const usersWithAnalytics = await this.prismaService.user.findMany({
      orderBy: {
        Analytics: {
          updatedAt: 'desc'
        }
      },
      select: {
        _count: {
          select: { Account: true, Order: true }
        },
        alias: true,
        Analytics: {
          select: {
            activityCount: true,
            updatedAt: true
          }
        },
        createdAt: true,
        id: true,
        Subscription: true
      },
      take: 30,
      where: {
        NOT: {
          Analytics: null
        }
      }
    });

    return usersWithAnalytics.map(
      ({ _count, alias, Analytics, createdAt, id, Subscription }) => {
        const daysSinceRegistration =
          differenceInDays(new Date(), createdAt) + 1;
        const engagement = Analytics.activityCount / daysSinceRegistration;

        const subscription = this.configurationService.get(
          'ENABLE_FEATURE_SUBSCRIPTION'
        )
          ? this.subscriptionService.getSubscription(Subscription)
          : undefined;

        return {
          alias,
          createdAt,
          engagement,
          id,
          subscription,
          accountCount: _count.Account || 0,
          lastActivity: Analytics.updatedAt,
          transactionCount: _count.Order || 0
        };
      }
    );
  }
}
