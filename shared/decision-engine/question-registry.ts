import type { DecisionQuestion } from './types.js';
import type { FlagId } from './flag-registry.js';

export type QuestionOption = {
  id: string;
  label: string;
  flagIds: readonly FlagId[];
};

function option(
  id: string,
  label: string,
  ...flagIds: FlagId[]
): QuestionOption {
  return { id, label, flagIds };
}

function question(
  id: string,
  prompt: string,
  options: readonly QuestionOption[],
): DecisionQuestion {
  return { id, prompt, options };
}

export const questionRegistry = {

  ownership: question(
    'ownership',
    'Apakah kamu sudah punya barang dengan fungsi yang sama?',
    [
      option('none', 'Belum punya'),
      option('insufficient', 'Sudah punya, tetapi kurang memadai'),
      option('adequate', 'Sudah punya dan masih memadai', 'existing_item_adequate'),
      option('multiple', 'Sudah punya beberapa barang serupa', 'multiple_equivalent_items'),
    ],
  ),

  condition: question(
    'condition',
    'Bagaimana kondisi barang yang kamu gunakan sekarang?',
    [
      option('broken', 'Sudah tidak bisa digunakan', 'replacement_confirmed'),
      option('problematic', 'Sering bermasalah', 'recurring_problem'),
      option('uncomfortable', 'Masih berfungsi, tetapi kurang nyaman', 'comfort_limitation'),
      option('unsafe', 'Sudah tidak aman digunakan', 'safety_concern'),
      option('good', 'Masih berfungsi dengan baik', 'existing_item_adequate'),
    ],
  ),

  impact: question(
    'impact',
    'Apa manfaat utama yang kamu harapkan dari barang ini?',
    [
      option('disruption', 'Mengatasi hambatan aktivitas', 'activity_disruption'),
      option('functional', 'Mempermudah aktivitas', 'functional_benefit'),
      option('comfort', 'Meningkatkan kenyamanan', 'comfort_benefit'),
      option('personal', 'Memberikan kepuasan pribadi', 'personal_value'),
      option('unknown', 'Belum tahu manfaat pastinya'),
    ],
  ),

  problem_frequency: question(
    'problem_frequency',
    'Seberapa sering masalah tersebut mengganggu kamu?',
    [
      option('daily', 'Hampir setiap hari'),
      option('weekly', 'Beberapa kali dalam seminggu'),
      option('monthly', 'Beberapa kali dalam sebulan'),
      option('rarely', 'Sesekali'),
      option('unknown', 'Belum bisa memastikan'),
    ],
  ),

  additional_benefit: question(
    'additional_benefit',
    'Apa yang membuat barang ini lebih menarik daripada yang sudah kamu punya?',
    [
      option('functional', 'Fungsi yang lebih membantu', 'functional_benefit'),
      option('efficiency', 'Aktivitas jadi lebih efisien', 'efficiency_gain'),
      option('comfort', 'Lebih nyaman digunakan', 'comfort_benefit'),
      option('experience', 'Memberikan pengalaman yang berbeda', 'distinct_experience'),
      option('appearance', 'Desain atau tampilannya', 'aesthetic_desire'),
      option('similar', 'Sebenarnya tidak banyak perbedaan', 'optional_upgrade'),
    ],
  ),

  usage_frequency: question(
    'usage_frequency',
    'Seberapa sering kamu berencana menggunakan barang ini?',
    [
      option('daily', 'Hampir setiap hari'),
      option('weekly', 'Beberapa kali dalam seminggu'),
      option('monthly', 'Beberapa kali dalam sebulan'),
      option('rarely', 'Sesekali'),
      option('unknown', 'Belum tahu'),
    ],
  ),

  desire_duration: question(
    'desire_duration',
    'Sudah berapa lama kamu menginginkan barang seperti ini?',
    [
      option('today', 'Baru hari ini', 'spontaneous_desire'),
      option('recent', 'Beberapa hari atau minggu', 'recent_desire'),
      option('months', 'Satu sampai kurang dari enam bulan'),
      option('long_term', 'Enam bulan atau lebih'),
      option('unknown', 'Tidak ingat'),
    ],
  ),

  promotion_dependency: question(
    'promotion_dependency',
    'Kalau tidak sedang diskon, apakah kamu masih menginginkannya?',
    [
      option('yes', 'Ya, tetap menginginkannya'),
      option('wait', 'Ya, tetapi mungkin menunggu harga lebih baik'),
      option('no', 'Tidak, diskonnya yang membuat tertarik', 'promotion_dependency'),
      option('unknown', 'Belum yakin'),
    ],
  ),

  social_influence: question(
    'social_influence',
    'Seberapa besar pengaruh orang lain terhadap keinginanmu?',
    [
      option('independent', 'Ini memang keinginanku sendiri'),
      option('introduced', 'Awalnya dari rekomendasi, tetapi sesuai kebutuhanku'),
      option('trend', 'Tertarik karena sedang tren', 'social_influence'),
      option('fomo', 'Takut ketinggalan dari orang lain', 'fomo_signal'),
    ],
  ),

  scarcity: question(
    'scarcity',
    'Kalau barang ini selalu tersedia, apakah kamu masih ingin membelinya?',
    [
      option('yes', 'Ya, tetap ingin'),
      option('later', 'Ya, tetapi tidak harus sekarang'),
      option('no', 'Tidak, kelangkaannya yang membuat tertarik', 'scarcity_dependency'),
      option('unknown', 'Belum yakin'),
    ],
  ),

  alternatives: question(
    'alternatives',
    'Adakah cara lain untuk mendapatkan manfaat yang sama?',
    [
      option('free_equivalent', 'Ada, tanpa perlu mengeluarkan uang', 'equivalent_free_alternative'),
      option('cheaper', 'Ada pilihan lain yang lebih murah'),
      option('insufficient', 'Ada, tetapi manfaatnya tidak sama'),
      option('none', 'Belum ada alternatif yang sesuai'),
      option('unknown', 'Belum mencari alternatif'),
    ],
  ),

  repair: question(
    'repair',
    'Apakah barang lama masih memungkinkan untuk diperbaiki?',
    [
      option('yes', 'Ya, kemungkinan masih bisa', 'repair_possible'),
      option('no', 'Tidak bisa diperbaiki'),
      option('unknown', 'Belum tahu'),
    ],
  ),

  repair_willingness: question(
    'repair_willingness',
    'Kalau diperbaiki, apakah barang lama masih cukup untuk kebutuhanmu?',
    [
      option('accepted', 'Ya, dan aku bersedia memperbaikinya', 'repair_accepted'),
      option('unwilling', 'Ya, tetapi aku lebih memilih menggantinya'),
      option('insufficient', 'Tidak, kebutuhanku sudah berbeda'),
      option('unknown', 'Belum bisa memastikan'),
    ],
  ),

  need_timing: question(
    'need_timing',
    'Kapan kamu benar-benar membutuhkan manfaat barang ini?',
    [
      option('now', 'Sekarang', 'immediate_need'),
      option('soon', 'Dalam beberapa minggu'),
      option('future', 'Beberapa bulan lagi', 'future_need'),
      option('flexible', 'Tidak ada waktu tertentu', 'low_urgency'),
      option('unknown', 'Belum tahu'),
    ],
  ),

  delay_consequence: question(
    'delay_consequence',
    'Apa yang terjadi kalau kamu menunda pembelian ini?',
    [
      option('serious', 'Aktivitas penting akan terganggu', 'delay_consequence'),
      option('discomfort', 'Tetap bisa beraktivitas, tetapi kurang nyaman'),
      option('minor', 'Hanya menunda manfaat atau kepuasan'),
      option('none', 'Tidak ada dampak berarti', 'low_urgency'),
      option('unknown', 'Belum tahu'),
    ],
  ),

  product_fit: question(
    'product_fit',
    'Apakah barang ini sesuai dengan manfaat yang kamu cari?',
    [
      option('exact', 'Ya, sesuai dengan yang aku butuhkan', 'product_fit_confirmed'),
      option('essential', 'Fungsi utamanya sudah sesuai', 'essential_features_met'),
      option('excessive', 'Sesuai, tetapi banyak fitur yang tidak diperlukan', 'excessive_features'),
      option('partial', 'Hanya memenuhi sebagian kebutuhan', 'partial_product_fit'),
      option('mismatch', 'Sepertinya kurang sesuai', 'product_mismatch'),
      option('unknown', 'Belum yakin'),
    ],
  ),

  quality: question(
    'quality',
    'Seberapa yakin kamu dengan kualitas barang ini?',
    [
      option('verified', 'Sudah mencari informasi atau pernah mencobanya'),
      option('familiar', 'Cukup mengenal produk atau mereknya'),
      option('unknown', 'Belum mencari tahu'),
      option('concern', 'Masih ada keraguan tentang kualitasnya'),
    ],
  ),

  hobby_activity: question(
    'hobby_activity',
    'Bagaimana hubungan barang ini dengan hobimu?',
    [
      option('active', 'Bagian dari hobi yang aktif aku jalani', 'active_hobby'),
      option('collection', 'Melengkapi koleksi yang aku nikmati', 'collection_value'),
      option('returning', 'Hobi lama yang ingin aku jalani kembali', 'hobby_value'),
      option('new', 'Hobi baru yang ingin aku coba', 'new_interest'),
    ],
  ),

  hobby_experience: question(
    'hobby_experience',
    'Apakah barang ini memberikan pengalaman yang berbeda?',
    [
      option('distinct', 'Ya, ada pengalaman baru yang ingin aku nikmati', 'distinct_experience'),
      option('collection', 'Ya, memiliki nilai tersendiri dalam koleksiku', 'collection_value'),
      option('similar', 'Kurang lebih sama dengan yang sudah aku punya'),
      option('unknown', 'Belum tahu'),
    ],
  ),

  personal_value: question(
    'personal_value',
    'Apa yang membuat barang ini berarti untukmu?',
    [
      option('confidence', 'Membuatku lebih percaya diri', 'confidence_value'),
      option('emotional', 'Memberikan kepuasan atau kenyamanan pribadi', 'emotional_value'),
      option('appearance', 'Aku sangat menyukai desainnya', 'aesthetic_desire'),
      option('reward', 'Sebagai hadiah untuk diri sendiri', 'self_reward'),
      option('unknown', 'Belum menemukan alasan yang pasti'),
    ],
  ),

  reward_meaning: question(
    'reward_meaning',
    'Apa yang ingin kamu apresiasi dengan membeli barang ini?',
    [
      option('achievement', 'Pencapaian yang berarti bagiku', 'meaningful_achievement'),
      option('effort', 'Usaha yang sudah aku lakukan', 'personal_appreciation'),
      option('enjoyment', 'Sekadar ingin menyenangkan diri sendiri'),
      option('unknown', 'Tidak ada alasan khusus'),
    ],
  ),

  reward_planning: question(
    'reward_planning',
    'Apakah barang ini memang sudah kamu rencanakan sebagai hadiah?',
    [
      option('planned', 'Ya, sudah direncanakan sebelumnya', 'planned_reward'),
      option('wanted', 'Belum direncanakan, tetapi sudah lama diinginkan'),
      option('spontaneous', 'Baru terpikir sekarang', 'spontaneous_desire'),
    ],
  ),

  gift_fit: question(
    'gift_fit',
    'Mengapa kamu memilih barang ini sebagai hadiah?',
    [
      option('recipient_need', 'Sesuai kebutuhan penerimanya', 'recipient_benefit'),
      option('meaningful', 'Memiliki makna khusus untuk penerimanya', 'meaningful_gift'),
      option('preference', 'Sesuai dengan hal yang disukainya', 'meaningful_gift'),
      option('unknown', 'Belum yakin apakah dia akan menyukainya'),
    ],
  ),

  gift_timing: question(
    'gift_timing',
    'Apakah hadiah ini perlu diberikan pada waktu tertentu?',
    [
      option('soon', 'Ya, waktunya sudah dekat', 'gift_deadline'),
      option('future', 'Ya, tetapi masih beberapa bulan lagi', 'future_need'),
      option('flexible', 'Tidak, bisa diberikan kapan saja', 'low_urgency'),
    ],
  ),

  comfort_safety: question(
    'comfort_safety',
    'Apa yang paling ingin kamu tingkatkan?',
    [
      option('safety', 'Keamanan saat beraktivitas', 'safety_concern'),
      option('discomfort', 'Mengatasi rasa tidak nyaman', 'comfort_limitation'),
      option('comfort', 'Mendapatkan kenyamanan yang lebih baik', 'comfort_upgrade'),
      option('both', 'Keamanan dan kenyamanan', 'safety_concern', 'comfort_upgrade'),
    ],
  ),

  safety_detail: question(
    'safety_detail',
    'Apa yang membuat kamu merasa perlu meningkatkan keamanan?',
    [
      option('experienced', 'Sudah mengalami masalah keamanan', 'safety_confirmed'),
      option('potential', 'Ada risiko nyata yang ingin aku hindari', 'safety_confirmed'),
      option('preventive', 'Ingin perlindungan tambahan'),
      option('unknown', 'Belum bisa menjelaskan risikonya'),
    ],
  ),

  external_trigger: question(
    'external_trigger',
    'Apa yang pertama kali membuatmu tertarik?',
    [
      option('promotion', 'Diskon atau penawaran menarik', 'promotion_trigger'),
      option('social', 'Rekomendasi orang lain atau tren', 'social_influence'),
      option('scarcity', 'Stok terbatas atau edisi khusus', 'scarcity_pressure'),
      option('benefit', 'Baru mengetahui manfaat barang ini'),
    ],
  ),

} as const;

export type QuestionId = keyof typeof questionRegistry;

export function isQuestionId(value: string): value is QuestionId {
  return Object.prototype.hasOwnProperty.call(questionRegistry, value);
}

export function getQuestion(id: QuestionId): DecisionQuestion {
  return questionRegistry[id];
}

export function getAnswerOption(
  questionId: QuestionId,
  optionId: string,
) {
  return questionRegistry[questionId].options.find(
    item => item.id === optionId,
  );
}

export const questionOptions = Object.values(questionRegistry);