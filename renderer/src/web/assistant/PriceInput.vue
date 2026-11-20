<template>
  <!-- Amount and currency are independent: typing keeps the currency,
       a currency button keeps the amount. -->
  <div class="flex items-center gap-1 flex-wrap">
    <input
      ref="amountInput"
      :value="amountText"
      class="w-16 rounded bg-gray-900 px-1 text-yellow-300 placeholder-gray-600"
      :class="{ 'ring-1 ring-red-500': amountText.trim() && !valid }"
      type="text"
      inputmode="decimal"
      placeholder="价格"
      data-testid="price-amount"
      @input="onAmount"
    />
    <button
      v-for="id of COMMON_CURRENCIES"
      :key="id"
      class="flex items-center rounded px-1"
      :class="
        id === currency
          ? 'bg-gray-600 text-gray-100'
          : 'bg-gray-900 text-gray-400 hover:text-gray-200'
      "
      :data-testid="`price-currency-${id}`"
      @click="pick(id)"
    >
      <img
        v-if="icon(id)"
        :src="icon(id)!"
        class="w-5 h-5 -my-1"
        alt=""
        @error="hideImage"
      />{{ currencyName(id) }}
    </button>
    <select
      class="rounded px-1 max-w-[7rem]"
      :class="
        COMMON_CURRENCIES.includes(currency)
          ? 'bg-gray-900 text-gray-400'
          : 'bg-gray-600 text-gray-100'
      "
      :value="COMMON_CURRENCIES.includes(currency) ? '' : currency"
      data-testid="price-currency-more"
      @change="onMore"
    >
      <option value="" disabled>其他…</option>
      <template v-for="c of others" :key="c.id">
        <option v-if="c.id === 'sep'" disabled>──────</option>
        <option v-else :value="c.id">{{ c.zh }}</option>
      </template>
    </select>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  COMMON_CURRENCIES,
  TRADE_CURRENCIES,
  currencyIcon,
  currencyName,
  parseAmount,
} from "./price-value";

const props = defineProps<{
  amountText: string;
  currency: string;
  realm: string;
  // Put the cursor in the amount box when shown (no price yet).
  autofocus: boolean;
}>();

const emit = defineEmits<{
  (e: "update:amountText" | "update:currency", value: string): void;
}>();

const amountInput = ref<HTMLInputElement | null>(null);

const others = TRADE_CURRENCIES.filter(
  (c) => !COMMON_CURRENCIES.includes(c.id),
);
const valid = computed(() => parseAmount(props.amountText) !== null);

function icon(id: string) {
  return currencyIcon(id, props.realm);
}

function onAmount(e: Event) {
  emit("update:amountText", (e.target as HTMLInputElement).value);
}

function pick(id: string) {
  emit("update:currency", id);
}

function onMore(e: Event) {
  const id = (e.target as HTMLSelectElement).value;
  if (id) pick(id);
}

function hideImage(e: Event) {
  (e.target as HTMLImageElement).style.display = "none";
}

onMounted(() => {
  if (props.autofocus) amountInput.value?.focus();
});
</script>
