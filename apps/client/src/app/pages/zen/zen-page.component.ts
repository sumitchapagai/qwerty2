import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { LineChartItem } from '@ghostfolio/client/components/line-chart/interfaces/line-chart.interface';
import { DataService } from '@ghostfolio/client/services/data.service';
import { ImpersonationStorageService } from '@ghostfolio/client/services/impersonation-storage.service';
import { TokenStorageService } from '@ghostfolio/client/services/token-storage.service';
import { UserService } from '@ghostfolio/client/services/user/user.service';
import { PortfolioPerformance, User } from '@ghostfolio/common/interfaces';
import { hasPermission, permissions } from '@ghostfolio/common/permissions';
import { DateRange } from '@ghostfolio/common/types';
import { DeviceDetectorService } from 'ngx-device-detector';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'gf-zen-page',
  templateUrl: './zen-page.html',
  styleUrls: ['./zen-page.scss']
})
export class ZenPageComponent implements OnDestroy, OnInit {
  public dateRange: DateRange = 'max';
  public deviceType: string;
  public hasImpersonationId: boolean;
  public hasPermissionToReadForeignPortfolio: boolean;
  public historicalDataItems: LineChartItem[];
  public isLoadingPerformance = true;
  public performance: PortfolioPerformance;
  public user: User;

  private unsubscribeSubject = new Subject<void>();

  /**
   * @constructor
   */
  public constructor(
    private cd: ChangeDetectorRef,
    private dataService: DataService,
    private deviceService: DeviceDetectorService,
    private impersonationStorageService: ImpersonationStorageService,
    private tokenStorageService: TokenStorageService,
    private userService: UserService
  ) {
    this.tokenStorageService
      .onChangeHasToken()
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe(() => {
        this.userService.get().subscribe((user) => {
          this.user = user;

          this.hasPermissionToReadForeignPortfolio = hasPermission(
            user.permissions,
            permissions.readForeignPortfolio
          );

          this.cd.markForCheck();
        });
      });
  }

  /**
   * Initializes the controller
   */
  public ngOnInit() {
    this.deviceType = this.deviceService.getDeviceInfo().deviceType;

    this.impersonationStorageService
      .onChangeHasImpersonation()
      .subscribe((aId) => {
        this.hasImpersonationId = !!aId;
      });

    this.update();
  }

  public ngOnDestroy() {
    this.unsubscribeSubject.next();
    this.unsubscribeSubject.complete();
  }

  private update() {
    this.isLoadingPerformance = true;

    this.dataService
      .fetchChart({ range: this.dateRange })
      .subscribe((chartData) => {
        this.historicalDataItems = chartData.map((chartDataItem) => {
          return {
            date: chartDataItem.date,
            value: chartDataItem.value
          };
        });

        this.cd.markForCheck();
      });

    this.dataService
      .fetchPortfolioPerformance({ range: this.dateRange })
      .subscribe((response) => {
        this.performance = response;
        this.isLoadingPerformance = false;

        this.cd.markForCheck();
      });

    this.cd.markForCheck();
  }
}
