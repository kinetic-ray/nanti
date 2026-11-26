import type {
  EvidenceDimension,
  EvidenceWeight,
} from './types.js';

export type FlagDefinition = {
  dimension: EvidenceDimension;
  weight: EvidenceWeight;
  group: string;
};

export const flagRegistry = {
  functional_need: { dimension: 'need', weight: 3, group: 'functional' },
  first_ownership: { dimension: 'need', weight: 1, group: 'ownership' },
  replacement_needed: { dimension: 'need', weight: 4, group: 'replacement' },
  replacement_confirmed: { dimension: 'need', weight: 5, group: 'replacement' },
  recurring_problem: { dimension: 'need', weight: 4, group: 'functional' },
  activity_disruption: { dimension: 'need', weight: 5, group: 'functional' },
  functional_benefit: { dimension: 'need', weight: 4, group: 'functional' },
  efficiency_gain: { dimension: 'need', weight: 4, group: 'functional' },
  safety_concern: { dimension: 'need', weight: 5, group: 'safety' },
  safety_confirmed: { dimension: 'urgency', weight: 5, group: 'safety' },

  comfort_upgrade: { dimension: 'personal_value', weight: 3, group: 'comfort' },
  comfort_limitation: { dimension: 'personal_value', weight: 3, group: 'comfort' },
  daily_discomfort: { dimension: 'personal_value', weight: 5, group: 'comfort' },
  recurring_discomfort: { dimension: 'personal_value', weight: 4, group: 'comfort' },
  comfort_benefit: { dimension: 'personal_value', weight: 3, group: 'comfort' },
  daily_comfort: { dimension: 'personal_value', weight: 4, group: 'comfort' },
  emotional_value: { dimension: 'personal_value', weight: 4, group: 'emotional' },
  confidence_value: { dimension: 'personal_value', weight: 4, group: 'emotional' },
  aesthetic_desire: { dimension: 'personal_value', weight: 2, group: 'emotional' },
  personal_value: { dimension: 'personal_value', weight: 4, group: 'emotional' },
  hobby_value: { dimension: 'personal_value', weight: 4, group: 'hobby' },
  active_hobby: { dimension: 'personal_value', weight: 5, group: 'hobby' },
  collection_value: { dimension: 'personal_value', weight: 4, group: 'hobby' },
  distinct_experience: { dimension: 'personal_value', weight: 4, group: 'hobby' },
  new_interest: { dimension: 'personal_value', weight: 2, group: 'hobby' },
  self_reward: { dimension: 'personal_value', weight: 3, group: 'reward' },
  planned_reward: { dimension: 'personal_value', weight: 5, group: 'reward' },
  meaningful_achievement: { dimension: 'personal_value', weight: 4, group: 'reward' },
  personal_appreciation: { dimension: 'personal_value', weight: 3, group: 'reward' },
  gift_intent: { dimension: 'personal_value', weight: 2, group: 'gift' },
  meaningful_gift: { dimension: 'personal_value', weight: 4, group: 'gift' },
  recipient_benefit: { dimension: 'personal_value', weight: 4, group: 'gift' },

  immediate_need: { dimension: 'urgency', weight: 4, group: 'timing' },
  delay_consequence: { dimension: 'urgency', weight: 5, group: 'timing' },
  gift_deadline: { dimension: 'urgency', weight: 3, group: 'gift_timing' },

  promotion_trigger: { dimension: 'impulse', weight: 4, group: 'promotion' },
  promotion_dependency: { dimension: 'impulse', weight: 5, group: 'promotion' },
  social_influence: { dimension: 'impulse', weight: 3, group: 'social' },
  social_imitation: { dimension: 'impulse', weight: 3, group: 'social' },
  fomo_signal: { dimension: 'impulse', weight: 5, group: 'social' },
  scarcity_pressure: { dimension: 'impulse', weight: 3, group: 'scarcity' },
  scarcity_dependency: { dimension: 'impulse', weight: 5, group: 'scarcity' },
  spontaneous_desire: { dimension: 'impulse', weight: 4, group: 'desire_history' },
  recent_desire: { dimension: 'impulse', weight: 3, group: 'desire_history' },

  product_fit_confirmed: { dimension: 'product_fit', weight: 5, group: 'fit' },
  essential_features_met: { dimension: 'product_fit', weight: 4, group: 'fit' },
  partial_product_fit: { dimension: 'product_fit', weight: 2, group: 'fit' },

  existing_item_adequate: { dimension: 'deferral', weight: 3, group: 'ownership' },
  multiple_equivalent_items: { dimension: 'deferral', weight: 4, group: 'ownership' },
  equivalent_free_alternative: { dimension: 'deferral', weight: 5, group: 'alternative' },
  repair_possible: { dimension: 'deferral', weight: 2, group: 'repair' },
  repair_accepted: { dimension: 'deferral', weight: 5, group: 'repair' },
  future_need: { dimension: 'deferral', weight: 5, group: 'timing' },
  low_urgency: { dimension: 'deferral', weight: 3, group: 'timing' },
  optional_upgrade: { dimension: 'deferral', weight: 2, group: 'upgrade' },
  excessive_features: { dimension: 'deferral', weight: 4, group: 'product_mismatch' },
  product_mismatch: { dimension: 'deferral', weight: 5, group: 'product_mismatch' },
} as const satisfies Record<string, FlagDefinition>;

export type FlagId = keyof typeof flagRegistry;

export function isFlagId(value: string): value is FlagId {
  return Object.prototype.hasOwnProperty.call(flagRegistry, value);
}

export function getFlagDefinition(id: FlagId): FlagDefinition {
  return flagRegistry[id];
}