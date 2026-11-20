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
          </td>
          <td
            class="text-right whitespace-nowrap pl-1"
            :class="cellClass(row.dps, bestDps)"
          >
            {{ row.dps === null ? "—" : `${compact(row.dps)}%` }}
          </td>
          <td
            class="text-right whitespace-nowrap pl-1"
            :class="cellClass(row.ehp, bestEhp)"
          >
            {{ row.ehp === null ? "—" : compact(row.ehp) }}
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
  compact,
  currencyName,
  entrySlot,
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

const rows = computed(() =>
  props.entries.map((entry) => {
    const v = props.valueOf(entry);
    const slot = entrySlot(entry);
    return {
      entry,
      name:
        entry.result.item.name || entry.result.item.base_name || "未命名装备",
      slotLabel: entry.result.slots.length > 1 ? slot?.label : null,
      price: v.price
        ? `${amountText(v.price.amount)} ${currencyName(v.price.currency)}`
        : "—",
      dps: v.value?.dpsPercent ?? null,
      ehp: v.value ? v.value.ehp : null,
    };
  }),
);

function best(values: Array<number | null>): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length > 1 ? Math.max(...known) : null;
}
const bestDps = computed(() => best(rows.value.map((r) => r.dps)));
const bestEhp = computed(() => best(rows.value.map((r) => r.ehp)));

function cellClass(value: number | null, bestValue: number | null) {
  if (value === null) return "text-gray-500";
  if (bestValue !== null && value === bestValue && value > 0)
    return "text-green-400 font-bold";
  return value < 0 ? "text-red-400" : "text-gray-200";
}
</script>
