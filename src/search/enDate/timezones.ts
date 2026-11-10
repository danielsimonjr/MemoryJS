/**
 * Timezone abbreviation table for the in-repo English date parser.
 *
 * Adapted from chrono-node 2.9.1 so a trailing zone abbreviation
 * (`5pm EST`, `Jan 1 2020 PST`) resolves to the same offset. Zones whose
 * offset changes with daylight saving are expressed as rules evaluated
 * against the parsed date.
 *
 * See THIRD_PARTY_NOTICES for the chrono-node copyright and MIT license text.
 *
 * @module search/enDate/timezones
 * @internal
 */

// Adapted from chrono-node (https://github.com/wanasit/chrono), MIT License.
// Copyright (c) 2014 Wanasit Ranasinghe and contributors.

/** A zone with a fixed UTC offset, in minutes east of UTC. */
type FixedZone = number;

/** A zone whose offset depends on daylight saving time. */
interface DstZone {
  /** Offset during daylight saving time, in minutes. */
  dstOffset: number;
  /** Offset outside daylight saving time, in minutes. */
  standardOffset: number;
  /** First instant of daylight saving time for a UTC year. */
  dstStart(year: number): Date;
  /** First instant after daylight saving time for a UTC year. */
  dstEnd(year: number): Date;
}

/** Nth (1-based) `weekday` of a month, at midnight UTC. */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  let dayOfMonth = 0;
  let seen = 0;
  while (seen < n) {
    dayOfMonth++;
    const date = new Date(Date.UTC(year, month - 1, dayOfMonth, 0, 0, 0, 0));
    if (date.getUTCDay() === weekday) seen++;
  }
  return new Date(Date.UTC(year, month - 1, dayOfMonth, 0, 0, 0, 0));
}

/** Last `weekday` of a month, at midnight UTC. */
function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const firstOfNextMonth = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const weekdayOfFirstNextMonth = firstOfNextMonth.getUTCDay() === 0 ? 7 : firstOfNextMonth.getUTCDay();
  const targetWeekday = weekday === 0 ? 7 : weekday;

  let dayDiff: number;
  if (weekdayOfFirstNextMonth === targetWeekday) dayDiff = 7;
  else if (weekdayOfFirstNextMonth < targetWeekday) dayDiff = 7 + weekdayOfFirstNextMonth - targetWeekday;
  else dayDiff = weekdayOfFirstNextMonth - targetWeekday;

  return new Date(firstOfNextMonth.getTime() - dayDiff * 86_400_000);
}

/** US-style daylight saving: 2nd Sunday in March to 1st Sunday in November. */
function usDstZone(dstOffset: number, standardOffset: number): DstZone {
  return {
    dstOffset,
    standardOffset,
    dstStart: (year) => nthWeekdayOfMonth(year, 3, 0, 2),
    dstEnd: (year) => nthWeekdayOfMonth(year, 11, 0, 1),
  };
}

/** Central European daylight saving: last Sunday in March to last Sunday in October. */
const CET_ZONE: DstZone = {
  dstOffset: 120,
  standardOffset: 60,
  dstStart: (year) => lastWeekdayOfMonth(year, 3, 0),
  dstEnd: (year) => lastWeekdayOfMonth(year, 10, 0),
};

/** Abbreviations with a fixed offset, in minutes east of UTC. */
const FIXED_ZONES: Readonly<Record<string, FixedZone>> = {
  ACDT: 630, ACST: 570, ADT: -180, AEDT: 660, AEST: 600, AFT: 270, AKDT: -480, AKST: -540,
  ALMT: 360, AMST: -180, AMT: -240, ANAST: 720, ANAT: 720, AQTT: 300, ART: -180, AST: -240,
  AWDT: 540, AWST: 480, AZOST: 0, AZOT: -60, AZST: 300, AZT: 240, BNT: 480, BOT: -240,
  BRST: -120, BRT: -180, BST: 60, BTT: 360, CAST: 480, CAT: 120, CCT: 390, CDT: -300,
  CEST: 120, CHADT: 825, CHAST: 765, CKT: -600, CLST: -180, CLT: -240, COT: -300, CST: -360,
  CVT: -60, CXT: 420, ChST: 600, DAVT: 420, EASST: -300, EAST: -360, EAT: 180, ECT: -300,
  EDT: -240, EEST: 180, EET: 120, EGST: 0, EGT: -60, EST: -300, FJST: 780, FJT: 720,
  FKST: -180, FKT: -240, FNT: -120, GALT: -360, GAMT: -540, GET: 240, GFT: -180, GILT: 720,
  GMT: 0, GST: 240, GYT: -240, HAA: -180, HAC: -300, HADT: -540, HAE: -240, HAP: -420,
  HAR: -360, HAST: -600, HAT: -90, HAY: -480, HKT: 480, HLV: -210, HNA: -240, HNC: -360,
  HNE: -300, HNP: -480, HNR: -420, HNT: -150, HNY: -540, HOVT: 420, ICT: 420, IDT: 180,
  IOT: 360, IRDT: 270, IRKST: 540, IRKT: 540, IRST: 210, IST: 330, JST: 540, KGT: 360,
  KRAST: 480, KRAT: 480, KST: 540, KUYT: 240, LHDT: 660, LHST: 630, LINT: 840, MAGST: 720,
  MAGT: 720, MART: -510, MAWT: 300, MDT: -360, MESZ: 120, MEZ: 60, MHT: 720, MMT: 390,
  MSD: 240, MSK: 180, MST: -420, MUT: 240, MVT: 300, MYT: 480, NCT: 660, NDT: -90,
  NFT: 690, NOVST: 420, NOVT: 360, NPT: 345, NST: -150, NUT: -660, NZDT: 780, NZST: 720,
  OMSST: 420, OMST: 420, PDT: -420, PET: -300, PETST: 720, PETT: 720, PGT: 600, PHOT: 780,
  PHT: 480, PKT: 300, PMDT: -120, PMST: -180, PONT: 660, PST: -480, PWT: 540, PYST: -180,
  PYT: -240, RET: 240, SAMT: 240, SAST: 120, SBT: 660, SCT: 240, SGT: 480, SRT: -180,
  SST: -660, TAHT: -600, TFT: 300, TJT: 300, TKT: 780, TLT: 540, TMT: 300, TVT: 720,
  ULAT: 480, UTC: 0, UYST: -120, UYT: -180, UZT: 300, VET: -210, VLAST: 660, VLAT: 660,
  VUT: 660, WAST: 120, WAT: 60, WEST: 60, WESZ: 60, WET: 0, WEZ: 0, WFT: 720, WGST: -120,
  WGT: -180, WIB: 420, WIT: 540, WITA: 480, WST: 780, WT: 0, YAKST: 600, YAKT: 600,
  YAPT: 600, YEKST: 360, YEKT: 360,
};

/** Abbreviations whose offset depends on daylight saving time. */
const DST_ZONES: Readonly<Record<string, DstZone>> = {
  CET: CET_ZONE,
  CT: usDstZone(-300, -360),
  ET: usDstZone(-240, -300),
  MT: usDstZone(-360, -420),
  PT: usDstZone(-420, -480),
};

/**
 * Offset in minutes east of UTC for a zone abbreviation, or `null` when the
 * abbreviation is unknown.
 *
 * @param abbreviation - Uppercase zone abbreviation, e.g. `EST`
 * @param date - Instant the abbreviation applies to (drives daylight saving)
 */
export function timezoneOffsetFor(abbreviation: string, date: Date): number | null {
  const fixed = FIXED_ZONES[abbreviation];
  if (fixed !== undefined) return fixed;

  const zone = DST_ZONES[abbreviation];
  if (!zone) return null;

  const year = date.getUTCFullYear();
  const dstStart = zone.dstStart(year);
  const dstEnd = zone.dstEnd(year);
  return date > dstStart && !(date > dstEnd) ? zone.dstOffset : zone.standardOffset;
}
