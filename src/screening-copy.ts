import type { ScreeningQuestion, ScreeningResult, ScreeningSignal } from '../shared/screening.js';
import type { Message } from './messages.js';

export const screeningPrompts = {
  practicalNeed: 'Is there a specific practical need this item would meet?',
  alreadyHave: 'Do you already own something that can do the same job?',
  useOften: 'Do you think you’ll use this often?',
  canWait: 'Can you put this purchase off without it causing a problem?',
  withoutDiscount: 'Would you still want this at full price?',
  socialPressure: 'Are you worried you’ll miss out if you don’t buy this now?',
} as const satisfies Record<ScreeningQuestion, Message>;

export const screeningEvidence = {
  'no-clear-need': 'You haven’t identified a practical need for it.',
  'clear-need': 'You have a specific reason to use it.',
  'no-substitute': 'Nothing you own does the same job.',
  'has-substitute': 'Something you own can already do the job.',
  'occasional-use': 'You expect to use it only occasionally.',
  'frequent-use': 'You expect to use it often.',
  'delay-has-consequence': 'Waiting would cause a problem for you.',
  'safe-to-wait': 'You can wait without it causing a problem.',
  'discount-driven': 'You’re less interested at full price.',
  'interest-at-full-price': 'You’re interested even at full price.',
  'no-fomo-reported': 'You said you’re comfortable skipping it for now.',
  'fomo-reported': 'You said you’re worried about missing out.',
} as const satisfies Record<ScreeningSignal, Message>;

export const screeningOutcomes = {
  green: ['Clear practical need', 'This sounds like something you’ll use!',
    'Check whether the cost fits your budget before you decide.'],
  yellow: ['Worth a pause', 'Give it a little time.',
    'Use the answers below to see what you’d want to confirm before deciding.'],
  red: ['Little practical need', 'Sounds like you can skip this for now.',
    'Save it for later and see if your reasons change.'],
} as const satisfies Record<ScreeningResult['outcome'], readonly Message[]>;
