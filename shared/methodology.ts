import { impulseFactors, impulseRules, impulseVersion } from './impulse.js';
import { comparisonLimits, comparisonVersion } from './value-ranker.js';
import { timingVersion } from './purchase-timing.js';

export const intelligenceModules = ['impulse', 'comparison', 'timing'] as const;
export type IntelligenceModule = typeof intelligenceModules[number];
type Methodology = {
  title: string;
  version: string;
  updated: string;
  purpose: string;
  concepts: string;
  inputs: string;
  rules: string[];
  limitations: string;
  references: { label: string; href: string }[];
};

const original = {
  impulse: {
    title: 'Impulse Guard', version: impulseVersion, updated: '2026-11-18',
    purpose: 'Helps you reflect on what is driving a purchase decision.',
    concepts: 'Impulse-buying research examines immediate desire, situational cues, social norms, and self-regulation. Planning research explores how deciding in advance when and how to act can help people follow through.',
    inputs: 'Your answers about temporary interest, existing alternatives, offers, social pressure, research, waiting, and planning. You can also choose your own cooling-off period.',
    rules: [
      ...impulseFactors.map((factor) => `${factor.question} ${'concernOnNo' in factor ? 'No' : 'Yes'} adds ${factor.weight} ${factor.weight === 1 ? 'point' : 'points'}.`),
      `Low is below ${impulseRules.moderateAt}, Moderate starts at ${impulseRules.moderateAt}, and High starts at ${impulseRules.highAt} points. At least ${impulseRules.minimumAnswered} answers are required. If unanswered questions could change the band, the result is Insufficient information.`,
    ],
    limitations: 'The points, thresholds, and recommendation rules are Nanti design choices without independent validation. The result is a reflection aid. Your cooling-off preference affects only the suggested action and has no scientific default.',
    references: [
      { label: 'Rook & Fisher (1995), Normative Influences on Impulsive Buying Behavior', href: 'https://doi.org/10.1086/209452' },
      { label: 'Dholakia (2000), Temptation and resistance', href: 'https://doi.org/10.1002/1520-6793%28200011%2917%3A11%3C955%3A%3AAID-MAR3%3E3.0.CO%3B2-J' },
      { label: 'Iyer, Blut, Xiao & Grewal (2020), Impulse buying: a meta-analytic review', href: 'https://doi.org/10.1007/s11747-019-00670-w' },
      { label: 'Gollwitzer (1999), Implementation intentions: Strong effects of simple plans', href: 'https://bpb-us-e1.wpmucdn.com/wp.nyu.edu/dist/c/6235/files/2019/02/gollwitzer-1999-implementation-intentions.pdf' },
    ],
  },
  comparison: {
    title: 'Value Ranker', version: comparisonVersion, updated: '2026-11-18',
    purpose: 'Compares saved products against the priorities you choose.',
    concepts: 'Multi-criteria decision analysis and multi-attribute value models combine separate measures of value. Sensitivity analysis checks how conclusions move as assumptions change.',
    inputs: 'The products, your choice of benefit or cost criteria, your importance weights, saved unit prices, and ratings you supply on a shared 0–10 scale. Evidence notes record your reasoning without changing the scores.',
    rules: [
      'For each criterion, the best observed value is 1 and the worst is 0. Values in between are scaled linearly. More is better for benefits and less is better for costs. Identical values receive the same score of 1.',
      'Each contribution is the normalized value multiplied by its share of the total weight. The sum gives the overall score. A zero-weight criterion has no effect.',
      'Ranking requires at least two products, a positive weight, and a value for every product on every positively weighted criterion. Scores equal to nine decimal places share a rank.',
      `Sensitivity checks each criterion at weights 0 and ${comparisonLimits.weight}, keeping all other weights set to your choices. It reports valid scenarios that change the order or create or break a tie.`,
    ],
    limitations: 'The scaling, default criteria, and ranking rules are Nanti design choices without independent validation. Changing the products can change the best and worst values. An advantage on one criterion can offset a disadvantage on another. Affiliate commissions and sponsorships are excluded.',
    references: [
      { label: 'Department for Communities and Local Government (2009), Multi-criteria analysis: a manual', href: 'https://www.gov.uk/government/publications/multi-criteria-analysis-manual-for-making-government-policy' },
      { label: 'Government Analysis Function, An Introductory Guide to Multi-Criteria Decision Analysis', href: 'https://analysisfunction.civilservice.gov.uk/policy-store/an-introductory-guide-to-mcda/' },
    ],
  },
  timing: {
    title: 'Purchase Timing', version: timingVersion, updated: '2026-11-18',
    purpose: 'Checks whether a purchase fits after you set aside money for bills and your reserve.',
    concepts: 'The CFPB’s financial well-being framework includes meeting day-to-day obligations and having the capacity to absorb a financial shock.',
    inputs: 'The full purchase price, liquid funds, upcoming essential obligations, protected reserve, and any extra costs. You can also enter monthly savings and a target date.',
    rules: [
      'Available to spend is liquid funds minus essential obligations and your protected reserve. Total cost includes any extra costs you enter.',
      'Buy Now requires a known total and enough funds after both protections. Missing required amounts yield Insufficient Data. Enter zero explicitly when an obligation or reserve is zero.',
      'If there is a gap, positive monthly savings yield Wait. Months is the gap divided by monthly savings and rounded up. With no positive savings amount, the result is Reconsider.',
      'The target check assumes deposits start one month from the calculation date and recur on the same day, or the last day of a shorter month. Future savings must be available after bills and reserve needs.',
    ],
    limitations: 'The safety gate and recommendation rules are Nanti design choices without independent validation. This is educational planning support. It assumes steady savings and costs, uses the current UTC date, and does not forecast prices. Financial inputs are used for the current check only.',
    references: [
      { label: 'Consumer Financial Protection Bureau (2015), Financial well-being: The goal of financial education', href: 'https://www.consumerfinance.gov/data-research/research-reports/financial-well-being/' },
      { label: 'Consumer Financial Protection Bureau, Why financial well-being?', href: 'https://www.consumerfinance.gov/consumer-tools/financial-well-being/about/' },
    ],
  },
} satisfies Record<IntelligenceModule, Methodology>;

export function getMethodology(module: IntelligenceModule, version?: string): Methodology | null {
  const entry = original[module];
  return version === undefined || entry.version === version ? entry : null;
}
