/**
 * Узгодження назв часових поясів між браузером і PostgreSQL.
 *
 * Браузери (ICU) досі часто повертають застарілі назви — напр. Chrome дає «Europe/Kiev»,
 * а PostgreSQL із сучасною tzdata знає лише «Europe/Kyiv» (і навпаки на старих системах).
 * Тут — найпоширеніші перейменування з файлу backward бази IANA.
 */
export const LEGACY_TO_CURRENT = {
  'Europe/Kiev': 'Europe/Kyiv',
  'Europe/Uzhgorod': 'Europe/Kyiv',
  'Europe/Zaporozhye': 'Europe/Kyiv',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Dacca': 'Asia/Dhaka',
  'Asia/Thimbu': 'Asia/Thimphu',
  'Asia/Macao': 'Asia/Macau',
  'Asia/Ulan_Bator': 'Asia/Ulaanbaatar',
  'Asia/Ujung_Pandang': 'Asia/Makassar',
  'America/Godthab': 'America/Nuuk',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Africa/Asmera': 'Africa/Asmara',
  'Pacific/Enderbury': 'Pacific/Kanton',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
  'Etc/UTC': 'UTC',
  'Etc/GMT': 'UTC',
};

/** Зворотна мапа; для кількох старих назв (Kiev, Uzhgorod…) береться перша — головна */
const CURRENT_TO_LEGACY = {};
for (const [legacy, current] of Object.entries(LEGACY_TO_CURRENT)) CURRENT_TO_LEGACY[current] ??= legacy;

/**
 * Перша назва, яку знає база; інакше UTC.
 * @param {string} tz
 * @param {Set<string>} known назви з pg_timezone_names
 */
export function resolveTimeZone(tz, known) {
  for (const candidate of [tz, LEGACY_TO_CURRENT[tz], CURRENT_TO_LEGACY[tz]]) {
    if (candidate && known.has(candidate)) return candidate;
  }
  return 'UTC';
}
