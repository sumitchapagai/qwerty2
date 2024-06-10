import {
  DATE_FORMAT,
  getYesterday,
  interpolate
} from '@ghostfolio/common/helper';
import { products } from '@ghostfolio/common/personal-finance-tools';

import { Controller, Get, Res, VERSION_NEUTRAL, Version } from '@nestjs/common';
import { format } from 'date-fns';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

@Controller('sitemap.xml')
export class SitemapController {
  public sitemapXml = '';

  public constructor() {
    try {
      this.sitemapXml = fs.readFileSync(
        path.join(__dirname, 'assets', 'sitemap.xml'),
        'utf8'
      );
    } catch {}
  }

  @Get()
  @Version(VERSION_NEUTRAL)
  public async getSitemapXml(@Res() response: Response): Promise<void> {
    const currentDate = format(getYesterday(), DATE_FORMAT);

    response.setHeader('content-type', 'application/xml');
    response.send(
      interpolate(this.sitemapXml, {
        currentDate,
        personalFinanceTools: products
          .map(({ alias, key }) => {
            return [
              '<url>',
              `  <loc>https://ghostfol.io/de/ressourcen/personal-finance-tools/open-source-alternative-zu-${alias ?? key}</loc>`,
              `  <lastmod>${currentDate}T00:00:00+00:00</lastmod>`,
              '</url>',
              '<url>',
              `  <loc>https://ghostfol.io/en/resources/personal-finance-tools/open-source-alternative-to-${alias ?? key}</loc>`,
              `  <lastmod>${currentDate}T00:00:00+00:00</lastmod>`,
              '</url>',
              '<url>',
              `  <loc>https://ghostfol.io/it/risorse/personal-finance-tools/alternativa-open-source-a-${alias ?? key}</loc>`,
              `  <lastmod>${currentDate}T00:00:00+00:00</lastmod>`,
              '</url>',
              '<url>',
              `  <loc>https://ghostfol.io/nl/bronnen/personal-finance-tools/open-source-alternatief-voor-${alias ?? key}</loc>`,
              `  <lastmod>${currentDate}T00:00:00+00:00</lastmod>`,
              '</url>'
            ].join('\n');
          })
          .join('\n')
      })
    );
  }
}
