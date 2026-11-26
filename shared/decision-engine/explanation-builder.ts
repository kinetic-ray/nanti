import type {
  CombinedAssessment,
  CombinedOutcome,
} from './combined-assessment.js';

export const outcomeLabels: Record<CombinedOutcome, string> = {
  not_needed: 'Belum butuh',
  can_wait: 'Masih bisa ditunda',
  worth_considering: 'Layak dipertimbangkan',
  unclear_need: 'Kebutuhan belum jelas',
  worth_buying: 'Layak dibeli',
  should_wait: 'Sebaiknya ditunda',
  do_not_buy_now: 'Jangan beli sekarang',
};

const reasons: Record<string, string> = {
  free_equivalent_available:
    'Kebutuhanmu bisa terpenuhi tanpa membeli barang baru.',

  confirmed_safety_need:
    'Keamanan menjadi alasan penting untuk mempertimbangkan pembelian ini.',

  future_need:
    'Manfaat barang ini belum kamu perlukan sekarang.',

  repair_meets_need:
    'Memperbaiki barang lama masih bisa memenuhi kebutuhanmu.',

  multiple_equivalent_items:
    'Kamu sudah memiliki beberapa barang dengan manfaat serupa.',

  existing_item_still_adequate:
    'Barang yang kamu miliki masih cukup untuk kebutuhanmu.',

  promotion_without_clear_benefit:
    'Ketertarikanmu lebih banyak dipengaruhi promo daripada manfaat yang jelas.',

  insufficient_evidence:
    'Informasi yang tersedia belum cukup untuk menilai kebutuhanmu.',

  functional_and_personal_benefit:
    'Barang ini menawarkan manfaat fungsional sekaligus nilai pribadi.',

  strong_functional_benefit:
    'Barang ini berpotensi membantu aktivitasmu secara nyata.',

  strong_personal_value:
    'Barang ini memiliki nilai pribadi yang berarti bagimu.',

  impulse_without_clear_benefit:
    'Keinginan membeli belum didukung manfaat yang cukup jelas.',

  limited_purchase_benefit:
    'Ada manfaat yang bisa kamu dapatkan, tetapi pembelian belum perlu diprioritaskan.',

  unclear_purchase_motivation:
    'Alasan pembelianmu masih perlu diperjelas.',

  product_fit_limitation:
    'Produk yang dipilih belum sepenuhnya sesuai dengan manfaat yang kamu cari.',

  product_quality_or_fit_uncertain:
    'Kualitas atau kesesuaian produk masih perlu dipastikan.',

  impulse_risk_present:
    'Ada pengaruh yang dapat membuatmu mengambil keputusan terlalu cepat.',

  unresolved_evidence_conflict:
    'Beberapa jawabanmu masih menunjukkan informasi yang berbeda.',

  activity_disruption:
    'Aktivitasmu terganggu tanpa solusi yang memadai.',

  replacement_needed:
    'Barang lama sudah kurang memadai.',

  replacement_confirmed:
    'Barang lama sudah tidak dapat digunakan sebagaimana mestinya.',

  recurring_problem:
    'Masalah yang kamu alami terjadi berulang kali.',

  functional_benefit:
    'Pembelian ini dapat mempermudah aktivitasmu.',

  efficiency_gain:
    'Barang ini dapat membantu aktivitas menjadi lebih efisien.',

  safety_concern:
    'Ada pertimbangan keamanan yang perlu diperhatikan.',

  daily_discomfort:
    'Ketidaknyamanan yang kamu alami terjadi hampir setiap hari.',

  recurring_discomfort:
    'Ketidaknyamanan yang kamu alami terjadi berulang kali.',

  daily_comfort:
    'Manfaat kenyamanannya berpotensi kamu rasakan setiap hari.',

  emotional_value:
    'Kepuasan pribadi merupakan bagian dari manfaat pembelian ini.',

  confidence_value:
    'Barang ini dapat membantu meningkatkan rasa percaya dirimu.',

  personal_value:
    'Barang ini memberikan manfaat yang berarti secara pribadi.',

  hobby_value:
    'Pembelian ini berkaitan dengan hobi yang kamu nikmati.',

  active_hobby:
    'Barang ini mendukung hobi yang aktif kamu jalani.',

  collection_value:
    'Barang ini memiliki nilai tersendiri dalam koleksimu.',

  distinct_experience:
    'Barang ini menawarkan pengalaman yang berbeda.',

  planned_reward:
    'Pembelian ini sudah kamu rencanakan sebagai bentuk apresiasi diri.',

  meaningful_achievement:
    'Pembelian ini berkaitan dengan pencapaian yang berarti bagimu.',

  meaningful_gift:
    'Hadiah ini memiliki makna bagi penerimanya.',

  recipient_benefit:
    'Barang ini sesuai dengan kebutuhan penerima hadiah.',

  equivalent_free_alternative:
    'Ada alternatif yang memberikan manfaat setara tanpa biaya.',

  repair_accepted:
    'Kamu masih bersedia menggunakan barang lama setelah diperbaiki.',

  negative_monthly_surplus:
    'Pengeluaran dan kewajiban bulanan melebihi pendapatanmu.',

  purchase_exceeds_safe_cash:
    'Biaya pembelian melebihi dana yang tersedia di luar cadangan.',

  installment_exceeds_monthly_surplus:
    'Cicilan baru melebihi sisa anggaran bulananmu.',

  protected_reserve_not_met:
    'Dana yang tersedia belum memenuhi cadangan yang ingin kamu lindungi.',

  financial_information_incomplete:
    'Informasi finansial belum cukup untuk memastikan kesiapan pembelian.',

  no_remaining_financial_buffer:
    'Pembelian akan menyisakan ruang finansial yang sangat terbatas.',

  income_not_steady:
    'Pendapatan yang tidak tetap memerlukan ruang finansial tambahan.',

  installment_consumes_surplus:
    'Cicilan baru akan menggunakan sebagian besar sisa anggaran bulanan.',

  purchase_consumes_cash_buffer:
    'Pembelian akan menggunakan sebagian besar dana yang tersedia.',

  purchase_within_available_budget:
    'Berdasarkan data yang tersedia, biaya pembelian berada dalam batas anggaranmu.',
};

const actions: Record<string, string> = {
  use_existing_alternative:
    'Manfaatkan alternatif yang sudah tersedia sebelum membeli.',

  prioritize_safe_product:
    'Utamakan produk yang memenuhi kebutuhan keamananmu.',

  review_closer_to_need:
    'Pertimbangkan kembali ketika waktu kebutuhan semakin dekat.',

  repair_existing_item:
    'Cari tahu biaya dan hasil perbaikan barang yang kamu miliki.',

  use_existing_items:
    'Gunakan barang yang sudah kamu punya terlebih dahulu.',

  review_incremental_benefit:
    'Bandingkan manfaat tambahan dengan barang yang sudah kamu miliki.',

  reconsider_without_promotion:
    'Pertimbangkan kembali barang ini tanpa melihat diskonnya.',

  identify_expected_benefit:
    'Tentukan manfaat utama yang ingin kamu dapatkan dari barang ini.',

  review_purchase_readiness:
    'Pastikan pembelian sesuai dengan kondisi finansialmu.',

  reconsider_purchase_later:
    'Beri waktu sebelum mengambil keputusan pembelian.',

  review_benefit_later:
    'Simpan dulu barang ini dan evaluasi kembali manfaatnya nanti.',

  find_suitable_safe_alternative:
    'Cari produk lain yang lebih sesuai dengan kebutuhan keamananmu.',

  compare_more_suitable_products:
    'Bandingkan produk lain yang lebih sesuai dengan kebutuhanmu.',

  verify_product_quality_and_fit:
    'Periksa kualitas, spesifikasi, dan kesesuaian produk sebelum membeli.',

  review_product_choice_without_pressure:
    'Evaluasi kembali pilihan produk tanpa pengaruh promo atau tren.',

  find_affordable_safe_alternative:
    'Cari alternatif yang aman tanpa mengganggu kewajiban finansialmu.',

  protect_financial_obligations:
    'Prioritaskan kebutuhan rutin, kewajiban, dan dana cadanganmu.',

  build_purchase_budget:
    'Siapkan anggaran khusus sebelum melanjutkan pembelian.',

  purchase_within_budget:
    'Pastikan harga akhir tetap sesuai dengan anggaran yang sudah kamu evaluasi.',
};

export type DecisionExplanation = {
  title: string;
  reasons: readonly string[];
  financialReasons: readonly string[];
  action: string;
  financialNotice: string | null;
};

export function buildExplanation(
  assessment: CombinedAssessment,
): DecisionExplanation {
  const translate = (ids: readonly string[]) =>
    [...new Set(
      ids
        .map(id => reasons[id])
        .filter((value): value is string => Boolean(value)),
    )].slice(0, 3);

  return {
    title: outcomeLabels[assessment.outcome],

    reasons: translate(
      assessment.behavioral.reasonIds,
    ),

    financialReasons: translate(
      assessment.financial.reasonIds,
    ),

    action:
      actions[assessment.actionId] ??
      'Evaluasi kembali manfaat dan kondisi pembelianmu.',

    financialNotice:
      assessment.mode === 'basic'
        ? 'Analisis ini belum mempertimbangkan kondisi finansialmu.'
        : assessment.mode === 'partial'
          ? 'Analisis finansial menggunakan informasi yang tersedia. Beberapa data masih belum lengkap.'
          : null,
  };
}