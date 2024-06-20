export interface Product {
  alias?: string;
  founded?: number;
  hasFreePlan?: boolean;
  hasSelfHostingAbility?: boolean;
  isOpenSource?: boolean;
  key: string;
  languages?: string[];
  name: string;
  note?: string;
  origin?: string;
  pricingPerYear?: string;
  region?: string;
  slogan?: string;
  useAnonymously?: boolean;
}
