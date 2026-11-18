import { factorsForImpulseVersion } from '../shared/impulse.js';
import type { ImpulseFactor } from '../shared/impulse.js';
import type { IntelligenceModule, Methodology } from '../shared/methodology.js';
import { translate } from './messages.js';
import type { Language } from './messages.js';

const impulseId: Record<ImpulseFactor, readonly [string, string, string]> = {
  temporary: ['Apa yang paling mendorongmu membeli adalah keinginan sesaat?', 'Keinginan ini mungkin sementara.', 'Catat untuk apa kamu akan memakainya.'],
  need: ['Apakah produk ini menjawab kebutuhan yang bisa kamu sebutkan?', 'Kebutuhan untuk pembelian ini belum jelas.', 'Sebutkan untuk apa dan seberapa sering kamu akan memakainya.'],
  alternative: ['Apa kamu sudah punya barang yang bisa dipakai?', 'Barang yang sudah kamu punya mungkin cukup.', 'Coba dulu barang yang sudah kamu punya.'],
  promotion: ['Apakah penawaran terbatas membuatmu ingin cepat memutuskan?', 'Penawaran ini membuatmu merasa perlu cepat memutuskan.', 'Pertimbangkan lagi dengan waktu yang kamu tentukan sendiri.'],
  pressure: ['Apakah pilihan orang lain atau takut ketinggalan memengaruhi keputusanmu?', 'Keputusanmu dipengaruhi orang lain atau rasa takut ketinggalan.', 'Pikirkan pilihanmu kalau memutuskan sendiri.'],
  research: ['Sudahkah kamu mencari cara lain untuk memenuhi kebutuhan yang sama?', 'Mungkin masih ada pilihan lain yang belum dilihat.', 'Bandingkan satu pilihan lain, termasuk tetap memakai barang yang sudah ada.'],
  waiting: ['Apakah kamu masih akan menginginkan barang ini setelah sempat menimbangnya?', 'Keinginanmu mungkin berkurang setelah menunggu.', 'Pilih waktu untuk mengecek lagi.'],
  planned: ['Apakah kamu sudah merencanakan pembelian ini sebelum melihat penawaran atau produknya?', 'Pembelian ini belum masuk rencanamu sebelumnya.', 'Lihat apakah pembelian ini cocok dengan prioritas lainnya.'],
  withoutDiscount: ['Kalau nggak diskon, kamu masih pengin beli?', 'Diskonnya ikut bikin barang ini menarik.', 'Coba pikirkan apakah barangnya masih sepadan dengan harga normal.'],
  alreadyHave: ['Kamu sudah punya barang lain yang fungsinya sama?', 'Barang yang kamu punya sudah bisa dipakai untuk hal yang sama.', 'Coba pakai yang sudah ada sedikit lebih lama.'],
  useOften: ['Menurutmu, kamu bakal sering pakai barang ini?', 'Barang ini mungkin cuma sesekali dipakai.', 'Coba bayangkan kapan kamu akan memakainya.'],
  canWait: ['Kalau belinya ditunda, kegiatanmu tetap bisa jalan seperti biasa?', 'Kamu masih punya waktu buat memutuskan.', 'Kalau membantu, pilih kapan kamu mau cek lagi.'],
};

export function impulseCopy(language: Language, factor: ReturnType<typeof factorsForImpulseVersion>[number]) {
  if (language === 'en') return factor;
  const [question, reason, action] = impulseId[factor.id];
  return { ...factor, question, reason, action };
}

export function localizedMethodology(module: IntelligenceModule, data: Methodology, language: Language): Methodology {
  if (language === 'en') return data;
  if (data.version === '2.0.0') {
    if (module === 'impulse') return {
      ...data, title: 'Cek alasan beli',
      purpose: 'Membantu kamu melihat apa yang bikin kamu ingin membeli.',
      concepts: 'Riset membahas bagaimana penawaran, situasi, dan waktu untuk mempertimbangkan pilihan bisa memengaruhi keputusan beli.',
      inputs: 'Empat jawaban tentang diskon, barang yang kamu punya, seberapa sering barangnya akan dipakai, dan apakah belinya bisa ditunda.',
      rules: [
        'Setiap jawaban yang memberi alasan untuk menunggu dihitung satu poin. Nol atau satu berarti sedikit alasan untuk menunggu, dua berarti layak dipikirkan lagi, dan tiga atau empat berarti pertimbangkan untuk memberi jeda.',
        'Kalau jawaban kurang dari tiga atau masih bisa mengubah hasil, beberapa hal masih belum jelas.',
        'Jeda yang disimpan punya tanggal cek ulang. Satu bulan berarti tanggal yang sama bulan depan atau hari terakhir jika bulannya lebih pendek. Tanggal dihitung dengan UTC.',
      ],
      limitations: 'Nanti memilih pertanyaan, poin, dan pilihan jeda ini sebagai bahan pertimbangan. Lama menunggu tidak bisa menentukan apakah barang ini kebutuhanmu.',
    };
    if (module === 'comparison') return {
      ...data, title: 'Bandingkan prioritas',
      purpose: 'Membantu kamu melihat barang mana yang bisa didahulukan.',
      concepts: 'Analisis multikriteria melihat beberapa pertimbangan dalam satu keputusan.',
      inputs: 'Jawabanmu tentang kegunaan, urgensi, kecocokan dengan anggaran, dan seberapa besar kamu menginginkannya, untuk sampai enam barang dari wishlist kamu.',
      rules: [
        'Tiap jawaban mendapat nol, satu, atau dua poin. Kalau kamu memilih satu pertimbangan yang paling penting, poinnya dihitung dua kali.',
        'Barang dengan poin lebih tinggi tampil duluan. Poin yang sama berarti setara. Untuk satu barang, Nanti menampilkan pertimbangan dan langkah berikutnya.',
        'Kecocokan dengan anggaran mengikuti jawabanmu. Harga ditampilkan dalam mata uang aslinya tanpa konversi atau perbandingan langsung antar mata uang.',
      ],
      limitations: 'Hasil mengikuti jawabanmu dan cara Nanti menghitungnya. Ini bukan ukuran nilai objektif. Komisi dan sponsor tidak memengaruhi hasil.',
    };
    return {
      ...data, title: 'Cek kesiapan beli',
      purpose: 'Membantu kamu memutuskan apakah mau beli sekarang atau memberi waktu dulu.',
      concepts: 'Kerangka kesejahteraan keuangan CFPB mencakup kemampuan memenuhi kebutuhan harian dan menghadapi pengeluaran mendadak.',
      inputs: 'Jawabanmu tentang kebutuhan penting, serta harga dan jumlah barang yang sudah tersimpan.',
      rules: [
        'Aman, agak mepet, dan belum yakin mengarah ke saran yang berbeda. Nanti tidak meminta atau memperkirakan saldo dan pengeluaran.',
        'Harga yang diketahui dikalikan jumlah. Kalau ada harga kosong, yang ditampilkan hanya subtotal harga yang diketahui dan totalnya belum lengkap.',
      ],
      limitations: 'Cek ini mengikuti jawabanmu. Cek lebih detail memakai metode anggaran lain jika kamu memilih untuk mengisi angkanya.',
    };
  }
  const v1 = data.version === '1.0.0';
  if (module === 'impulse') return {
    ...data, title: translate(language, 'Impulse Guard'),
    purpose: 'Membantu kamu memikirkan apa yang mendorong keputusan beli.',
    concepts: 'Riset pembelian impulsif membahas keinginan sesaat, situasi, pengaruh sosial, dan cara mengendalikan diri. Riset tentang perencanaan melihat manfaat menentukan kapan dan bagaimana kita akan bertindak.',
    inputs: v1 ? 'Jawaban tentang keinginan sesaat, alternatif yang sudah ada, penawaran, pengaruh sosial, riset, menunggu, dan rencana. Kamu juga bisa memilih lama menunggu.'
      : 'Jawaban tentang kebutuhan yang jelas, alternatif yang sudah ada, penawaran, pengaruh sosial, riset, menunggu, dan rencana. Kamu juga bisa memilih lama menunggu.',
    rules: [
      ...factorsForImpulseVersion(data.version).map((factor) =>
        `${impulseId[factor.id][0]} Jawaban ${'concernOnNo' in factor ? 'Tidak' : 'Ya'} menambah ${factor.weight} poin.`),
      'Rendah berarti kurang dari 4 poin, Sedang mulai dari 4, dan Tinggi mulai dari 8. Minimal 5 pertanyaan perlu dijawab. Jika jawaban yang kosong masih bisa mengubah tingkat hasil, informasinya belum lengkap.',
    ],
    limitations: 'Poin, batas, dan aturan saran dipilih Nanti dan belum diuji secara independen. Hasil ini membantu kamu berpikir sebelum membeli. Lama menunggu hanya memengaruhi saran dan tidak punya angka baku dari riset.',
  };
  if (module === 'comparison') return {
    ...data, title: translate(language, 'Value Ranker'),
    purpose: 'Membandingkan produk tersimpan berdasarkan prioritas yang kamu pilih.',
    concepts: 'Analisis multikriteria dan model nilai multiatribut menggabungkan beberapa ukuran nilai. Analisis sensitivitas melihat bagaimana hasil berubah saat asumsinya berubah.',
    inputs: 'Produk, kriteria manfaat atau biaya, bobot pilihanmu, harga satuan tersimpan, dan nilai 0 sampai 10 yang kamu isi. Catatan membantu menjelaskan alasanmu tanpa mengubah poin.',
    rules: [
      'Nilai terbaik pada tiap kriteria mendapat 1 dan yang terendah 0. Nilai di antaranya disesuaikan secara proporsional. Untuk manfaat, angka lebih besar lebih baik. Untuk biaya, angka lebih kecil lebih baik. Nilai yang sama sama-sama mendapat 1.',
      'Poin tiap kriteria adalah nilai yang sudah disesuaikan dikalikan bagian bobotnya. Total poin menentukan urutan. Bobot 0 tidak berpengaruh.',
      'Untuk mengurutkan produk, pilih minimal dua produk, beri setidaknya satu bobot di atas 0, dan lengkapi nilai setiap kriteria berbobot. Poin yang sama hingga sembilan desimal berbagi peringkat.',
      'Cek sensitivitas mencoba bobot 0 dan 100 untuk satu kriteria pada satu waktu. Bobot lainnya tetap. Nanti menampilkan skenario yang mengubah urutan atau hasil seri.',
    ],
    limitations: 'Skala, pilihan awal kriteria, dan cara mengurutkan ditentukan Nanti dan belum diuji secara independen. Produk yang dipilih bisa mengubah skala. Kelebihan di satu kriteria bisa menutup kekurangan di kriteria lain. Komisi afiliasi dan sponsor tidak masuk perhitungan.',
  };
  const rules = [
    'Dana yang bisa dipakai adalah dana tersedia dikurangi kebutuhan wajib dan cadangan. Total pembelian mencakup biaya tambahan yang kamu isi.',
    'Dana cukup jika total diketahui dan masih muat setelah dua jumlah tersebut disisihkan. Jika ada data wajib yang kosong, hasilnya belum lengkap. Isi 0 jika tidak ada kebutuhan wajib atau cadangan.',
    'Jika dananya kurang dan ada tabungan bulanan, kamu bisa menunggu. Jumlah bulan dihitung dari kekurangan dana dibagi tabungan bulanan, lalu dibulatkan ke atas. Tanpa tabungan di atas 0, hasilnya menyarankan pertimbangkan lagi.',
    'Perkiraan target menganggap tabungan masuk mulai bulan depan pada tanggal yang sama atau pada hari terakhir jika bulannya lebih pendek. Tabungan perlu tersedia setelah kebutuhan wajib dan cadangan terpenuhi.',
  ];
  return {
    ...data, title: translate(language, 'Purchase Timing'),
    purpose: 'Mengecek apakah pembelian masih muat setelah dana untuk kebutuhan wajib dan cadangan disisihkan.',
    concepts: 'Kerangka kesejahteraan keuangan CFPB mencakup kemampuan memenuhi kebutuhan harian dan menghadapi pengeluaran mendadak.',
    inputs: 'Total harga beli, dana tersedia, kebutuhan wajib, dana cadangan, dan biaya tambahan. Kamu juga bisa mengisi tabungan bulanan dan tanggal target.'
      + (v1 ? '' : ' Untuk wishlist, perhitungan juga memakai produk yang dipilih, jumlah, dan grup pilihan.'),
    rules: v1 ? rules : [
      'Total hanya mencakup produk yang dipilih. Harga satuan dikalikan jumlah, dan setiap grup menyumbang maksimal satu produk. Jika harga belum lengkap, isi perkiraan total secara utuh.',
      ...rules,
      'Jika dana masih kurang dan tabungan nol, atau belum ada setoran sebelum target, dana tidak akan cukup pada target.',
    ],
    limitations: 'Ini alat bantu perencanaan. Aturannya dipilih Nanti dan belum diuji secara independen. Perkiraan memakai biaya dan tabungan tetap serta tanggal UTC. '
      + (v1 ? 'Nanti tidak memprediksi harga. Data keuangan hanya dipakai untuk pengecekan saat itu.'
        : 'Hasil tersimpan memuat detail pembelian dan ringkasan. Tanda pembanding tersandi mendeteksi perubahan dana, kebutuhan wajib, cadangan, dan tabungan tanpa menyimpan jumlahnya.'),
  };
}
