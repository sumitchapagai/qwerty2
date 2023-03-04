import { BenchmarkService } from '@ghostfolio/api/app/benchmark/benchmark.service';
import { RedisCacheService } from '@ghostfolio/api/app/redis-cache/redis-cache.service';
import { ConfigurationService } from '@ghostfolio/api/services/configuration.service';
import { ExchangeRateDataService } from '@ghostfolio/api/services/exchange-rate-data.service';
import { PrismaService } from '@ghostfolio/api/services/prisma.service';
import { PropertyService } from '@ghostfolio/api/services/property/property.service';
import { TagService } from '@ghostfolio/api/services/tag/tag.service';
import {
  PROPERTY_COUNTRIES_OF_SUBSCRIBERS,
  PROPERTY_IS_READ_ONLY_MODE,
  PROPERTY_SLACK_COMMUNITY_USERS,
  PROPERTY_STRIPE_CONFIG,
  PROPERTY_SYSTEM_MESSAGE,
  PROPERTY_DEMO_USER_ID,
  ghostfolioFearAndGreedIndexDataSource
} from '@ghostfolio/common/config';
import {
  encodeDataSource,
  extractNumberFromString
} from '@ghostfolio/common/helper';
import { InfoItem } from '@ghostfolio/common/interfaces';
import { Statistics } from '@ghostfolio/common/interfaces/statistics.interface';
import { Subscription } from '@ghostfolio/common/interfaces/subscription.interface';
import { permissions } from '@ghostfolio/common/permissions';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bent from 'bent';
import * as cheerio from 'cheerio';
import { subDays } from 'date-fns';

@Injectable()
export class InfoService {
  private static CACHE_KEY_STATISTICS = 'STATISTICS';

  public constructor(
    private readonly benchmarkService: BenchmarkService,
    private readonly configurationService: ConfigurationService,
    private readonly exchangeRateDataService: ExchangeRateDataService,
    private readonly jwtService: JwtService,
    private readonly prismaService: PrismaService,
    private readonly propertyService: PropertyService,
    private readonly redisCacheService: RedisCacheService,
    private readonly tagService: TagService
  ) {}

  public async get(): Promise<InfoItem> {
    const info: Partial<InfoItem> = {};
    let isReadOnlyMode: boolean;
    const platforms = await this.prismaService.platform.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true }
    });
    let systemMessage: string;

    const globalPermissions: string[] = [];

    if (this.configurationService.get('ENABLE_FEATURE_BLOG')) {
      globalPermissions.push(permissions.enableBlog);
    }

    if (this.configurationService.get('ENABLE_FEATURE_FEAR_AND_GREED_INDEX')) {
      if (this.configurationService.get('ENABLE_FEATURE_SUBSCRIPTION')) {
        info.fearAndGreedDataSource = encodeDataSource(
          ghostfolioFearAndGreedIndexDataSource
        );
      } else {
        info.fearAndGreedDataSource = ghostfolioFearAndGreedIndexDataSource;
      }

      globalPermissions.push(permissions.enableFearAndGreedIndex);
    }

    if (this.configurationService.get('ENABLE_FEATURE_READ_ONLY_MODE')) {
      isReadOnlyMode = (await this.propertyService.getByKey(
        PROPERTY_IS_READ_ONLY_MODE
      )) as boolean;
    }

    if (this.configurationService.get('ENABLE_FEATURE_SOCIAL_LOGIN')) {
      globalPermissions.push(permissions.enableSocialLogin);
    }

    if (this.configurationService.get('ENABLE_FEATURE_STATISTICS')) {
      globalPermissions.push(permissions.enableStatistics);
    }

    if (this.configurationService.get('ENABLE_FEATURE_SUBSCRIPTION')) {
      globalPermissions.push(permissions.enableSubscription);

      info.countriesOfSubscribers =
        ((await this.propertyService.getByKey(
          PROPERTY_COUNTRIES_OF_SUBSCRIBERS
        )) as string[]) ?? [];
      info.stripePublicKey = this.configurationService.get('STRIPE_PUBLIC_KEY');
    }

    if (this.configurationService.get('ENABLE_FEATURE_SYSTEM_MESSAGE')) {
      globalPermissions.push(permissions.enableSystemMessage);

      systemMessage = (await this.propertyService.getByKey(
        PROPERTY_SYSTEM_MESSAGE
      )) as string;
    }

    const isUserSignupEnabled =
      await this.propertyService.isUserSignupEnabled();

    if (isUserSignupEnabled) {
      globalPermissions.push(permissions.createUserAccount);
    }

    return {
      ...info,
      globalPermissions,
      isReadOnlyMode,
      platforms,
      systemMessage,
      baseCurrency: this.configurationService.get('BASE_CURRENCY'),
      benchmarks: await this.benchmarkService.getBenchmarkAssetProfiles(),
      currencies: this.exchangeRateDataService.getCurrencies(),
      demoAuthToken: await this.getDemoAuthToken(),
      statistics: await this.getStatistics(),
      subscriptions: await this.getSubscriptions(),
      tags: await this.tagService.get()
    };
  }

  private async countActiveUsers(aDays: number) {
    return await this.prismaService.user.count({
      orderBy: {
        Analytics: {
          updatedAt: 'desc'
        }
      },
      where: {
        AND: [
          {
            NOT: {
              Analytics: null
            }
          },
          {
            Analytics: {
              updatedAt: {
                gt: subDays(new Date(), aDays)
              }
            }
          }
        ]
      }
    });
  }

  private async countDockerHubPulls(): Promise<number> {
    try {
      const get = bent(
        `https://hub.docker.com/v2/repositories/ghostfolio/ghostfolio`,
        'GET',
        'json',
        200,
        {
          'User-Agent': 'request'
        }
      );

      const { pull_count } = await get();
      return pull_count;
    } catch (error) {
      Logger.error(error, 'InfoService');

      return undefined;
    }
  }

  private async countGitHubContributors(): Promise<number> {
    try {
      const get = bent(
        'https://github.com/ghostfolio/ghostfolio',
        'GET',
        'string',
        200,
        {}
      );

      const html = await get();
      const $ = cheerio.load(html);

      return extractNumberFromString(
        $(
          `a[href="/ghostfolio/ghostfolio/graphs/contributors"] .Counter`
        ).text()
      );
    } catch (error) {
      Logger.error(error, 'InfoService');

      return undefined;
    }
  }

  private async countGitHubStargazers(): Promise<number> {
    try {
      const get = bent(
        `https://api.github.com/repos/ghostfolio/ghostfolio`,
        'GET',
        'json',
        200,
        {
          'User-Agent': 'request'
        }
      );

      const { stargazers_count } = await get();
      return stargazers_count;
    } catch (error) {
      Logger.error(error, 'InfoService');

      return undefined;
    }
  }

  private async countNewUsers(aDays: number) {
    return await this.prismaService.user.count({
      orderBy: {
        createdAt: 'desc'
      },
      where: {
        AND: [
          {
            NOT: {
              Analytics: null
            }
          },
          {
            createdAt: {
              gt: subDays(new Date(), aDays)
            }
          }
        ]
      }
    });
  }

  private async countSlackCommunityUsers() {
    return (await this.propertyService.getByKey(
      PROPERTY_SLACK_COMMUNITY_USERS
    )) as string;
  }

  private async getDemoAuthToken() {
    const demoUserId = (await this.propertyService.getByKey(
      PROPERTY_DEMO_USER_ID
    )) as string;

    if (demoUserId) {
      return this.jwtService.sign({
        id: demoUserId
      });
    }

    return undefined;
  }

  private async getStatistics() {
    if (!this.configurationService.get('ENABLE_FEATURE_STATISTICS')) {
      return undefined;
    }

    let statistics: Statistics;

    try {
      statistics = JSON.parse(
        await this.redisCacheService.get(InfoService.CACHE_KEY_STATISTICS)
      );

      if (statistics) {
        return statistics;
      }
    } catch {}

    const activeUsers1d = await this.countActiveUsers(1);
    const activeUsers30d = await this.countActiveUsers(30);
    const newUsers30d = await this.countNewUsers(30);

    const dockerHubPulls = await this.countDockerHubPulls();
    const gitHubContributors = await this.countGitHubContributors();
    const gitHubStargazers = await this.countGitHubStargazers();
    const slackCommunityUsers = await this.countSlackCommunityUsers();

    statistics = {
      activeUsers1d,
      activeUsers30d,
      dockerHubPulls,
      gitHubContributors,
      gitHubStargazers,
      newUsers30d,
      slackCommunityUsers
    };

    await this.redisCacheService.set(
      InfoService.CACHE_KEY_STATISTICS,
      JSON.stringify(statistics)
    );

    return statistics;
  }

  private async getSubscriptions(): Promise<Subscription[]> {
    if (!this.configurationService.get('ENABLE_FEATURE_SUBSCRIPTION')) {
      return undefined;
    }

    let subscriptions: Subscription[] = [];

    const stripeConfig = (await this.prismaService.property.findUnique({
      where: { key: PROPERTY_STRIPE_CONFIG }
    })) ?? { value: '{}' };

    subscriptions = [JSON.parse(stripeConfig.value)];

    return subscriptions;
  }
}
