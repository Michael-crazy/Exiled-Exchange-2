<template>
  <!-- M08b: recently evaluated items side by side, per 1 base currency. -->
  <div data-testid="compare-list">
    <div class="flex items-baseline text-gray-400">
      <div class="flex-1">最近评估（每 1 {{ currencyName(base) }}）</div>
      <button
        class="text-xs text-gray-500 hover:text-gray-200"
        @click="emit('clear')"
      >
        清空其他
      </button>
    </div>
    <table class="w-full text-xs mt-1">
      <thead>
        <tr class="text-gray-500">
          <th class="text-left font-normal whitespace-nowrap">装备</th>
          <th class="text-right font-normal pl-1 whitespace-nowrap">价格</th>
          <th class="text-right font-normal pl-1 whitespace-nowrap">DPS</th>
          <th class="text-right font-normal pl-1 whitespace-nowrap">
            有效生命
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row of rows"
          :key="row.entry.key"
          class="cursor-pointer hover:bg-gray-700"
          :class="row.entry === current ? 'bg-gray-900' : ''"
          @click="emit('select', row.entry)"
        >
          <td class="truncate max-w-0 w-full py-0.5" :title="row.name">
            <span
              :class="row.entry === current ? 'text-gray-100' : 'text-gray-300'"
              >{{ row.name }}</span
            >
            <span v-if="row.slotLabel" class="text-gray-500">
              · {{ row.slotLabel }}</span
            >
          </td>
          <td class="text-right whitespace-nowrap pl-1 text-yellow-300">
            {{ row.price }}
            <div
              v-if="row.cheap"
              class="text-yellow-500"
              title="价格不足 0.05 神圣石：右边是提升本身，不按每 1 神圣石计算"
            >
              价格极低
            </div>
          </td>
          <td
            class="text-right whitespace-nowrap pl-1"
            :class="cellClass(row, 'dpsPercent', bestDps)"
          >
            {{ cellText(row, "dpsPercent") }}
          </td>
          <td
            class="text-right whitespace-nowrap pl-1"
            :class="cellClass(row, 'ehp', bestEhp)"
          >
            {{ cellText(row, "ehp") }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  type Entry,
  type EntryValue,
  amountText,
  currencyName,
  entrySlot,
  gainText,
  valueOrder,
} from "./price-value";

const props = defineProps<{
  entries: Entry[];
  current: Entry;
  base: string;
  valueOf: (entry: Entry) => EntryValue;
}>();

const emit = defineEmits<{
  (e: "select", entry: Entry): void;
  (e: "clear"): void;
}>();

type Row = {
  entry: Entry;
  v: EntryValue;
  name: string;
  slotLabel: string | null | undefined;
  price: string;
  cheap: boolean;
};
type Metric = "dpsPercent" | "ehp";

// Best value first; items without a gain last (V10 #21).
const rows = computed<Row[]>(() =>
  props.entries
    .map((entry) => ({ entry, v: props.valueOf(entry) }))
    .sort((a, b) => valueOrder(a.v, b.v))
    .map(({ entry, v }) => ({
      entry,
      v,
      name:
        entry.result.item.name || entry.result.item.base_name || "未命名装备",
      slotLabel: entry.result.slots.length > 1 ? entrySlot(entry)?.label : null,
      price: v.price
        ? `${amountText(v.price.amount)} ${currencyName(v.price.currency)}`
        : "—",
      cheap: !v.noGain && !!v.value?.cheap,
    })),
);

function cellText(row: Row, metric: Metric): string {
  if (row.v.noGain) return "无提升";
  const value = row.v.value;
  if (!value || (metric === "dpsPercent" && !value.hasDps)) return "—";
  return gainText(value[metric], metric === "dpsPercent" ? "%" : "");
}

// Highlighted only among values per currency (not the very cheap ones).
function best(metric: Metric): number | null {
  const known = rows.value
    .filter((r) => !r.v.noGain && r.v.value && !r.v.value.cheap)
    .map((r) => r.v.value![metric])
    .filter((v): v is number => v !== null);
  return known.length > 1 ? Math.max(...known) : null;
}
const bestDps = computed(() => best("dpsPercent"));
const bestEhp = computed(() => best("ehp"));

function cellClass(row: Row, metric: Metric, bestValue: number | null) {
  const value = row.v.noGain ? null : (row.v.value?.[metric] ?? null);
  if (value === null) return "text-gray-500";
  if (row.cheap) return "text-gray-400";
  if (bestValue !== null && value === bestValue)
    return "text-green-400 font-bold";
  return "text-gray-200";
}
</script>
