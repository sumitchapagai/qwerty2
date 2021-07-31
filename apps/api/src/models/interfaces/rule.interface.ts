import { UserSettings } from '@ghostfolio/api/models/interfaces/user-settings.interface';
import { EvaluationResult } from './evaluation-result.interface';
import { RuleSettings } from '@ghostfolio/api/models/interfaces/rule-settings.interface';

export interface RuleInterface<T extends RuleSettings> {
  evaluate(aRuleSettings: T): EvaluationResult;

  getSettings(aUserSettings: UserSettings): T;
}
