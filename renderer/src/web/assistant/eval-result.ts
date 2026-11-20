// Result of the backend's evaluate-item, as documented in
// PoE2-Build-Assistant sources/assistant-shell.md. The overlay only renders it.

export interface EvalResist {
  label: string;
  before: number;
  value: number;
  change: number;
  max: number;
  total: number;
  overcap: number;
}

export interface EvalAttributeGap {
  label: string;
  required: number;
  before: number;
  after: number;
}

export interface EvalSlot {
  slot: string;
  label: string;
  replaced: string | null;
  displaced: Array<{ slot: string; name: string; label: string }>;
  metrics: Record<string, unknown>;
  delta: Record<string, number>;
  dps: {
    before: number;
    after: number;
    absolute: number;
    percent: number | null;
  };
  resists: Record<"Fire" | "Cold" | "Lightning" | "Chaos", EvalResist>;
  attribute_gaps: Record<"Str" | "Dex" | "Int", EvalAttributeGap>;
  summary: string;
}

// Price note of an item copied in the in-game market.
export interface EvalPrice {
  kind: "buyout" | "price";
  amount: number;
  currency: string;
  currency_name: string | null;
}

export interface EvalResult {
  build: {
    name?: string | null;
    path?: string | null;
    // Resistance lines written wrongly in the build, fixed on load.
    corrected_lines?: number;
    // The build open in PoB has changes that are not saved yet.
    unsaved?: boolean;
  } | null;
  skill: {
    dps_source: "player" | "minion";
    main_skill: string | null;
    main_skill_name: string | null;
    minion_skill_name: string | null;
  };
  item: {
    rarity: string;
    name: string | null;
    base_name: string | null;
    unique_name: string | null;
    unrecognized: Array<{ line: number; text: string; note?: string }>;
    price?: EvalPrice | null;
  };
  slots: EvalSlot[];
  default_slot: string | null;
}

export type Trend = "up" | "down" | "same";

export function trend(change: number): Trend {
  return Math.round(change) > 0
    ? "up"
    : Math.round(change) < 0
      ? "down"
      : "same";
}

const grouping = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });

export function num(value: number): string {
  return grouping.format(Math.round(value));
}

export function signed(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0
    ? `+${grouping.format(rounded)}`
    : grouping.format(rounded);
}

const amountFormat = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 2,
  useGrouping: false,
});

// "一口价 1 蛻變石" / "标价 …"; unknown currencies keep the note's code.
export function priceText(price: EvalPrice): string {
  const kind = price.kind === "buyout" ? "一口价" : "标价";
  return `${kind} ${amountFormat.format(price.amount)} ${
    price.currency_name ?? price.currency
  }`;
}
