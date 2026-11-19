<template>
  <div class="flex flex-col gap-y-2">
    <div>
      <div class="text-base leading-tight" :class="nameClass">
        {{ result.item.name || result.item.base_name }}
      </div>
      <div
        v-if="
          result.item.base_name && result.item.base_name !== result.item.name
        "
        class="text-gray-400"
      >
        {{ result.item.base_name }}
      </div>
      <div class="text-gray-500 text-xs mt-1">
        BD {{ result.build?.name || "未命名" }} · 主技能
        {{ result.skill.main_skill_name || "未设置" }} ·
        <template v-if="result.skill.dps_source === 'minion'"
          >DPS 来自召唤物{{
            result.skill.minion_skill_name
              ? `（${result.skill.minion_skill_name}）`
              : ""
          }}</template
        >
        <template v-else>DPS 来自角色</template>
      </div>
    </div>

    <div v-if="unrecognized.length" class="text-yellow-400">
      <button class="text-left" @click="showUnrecognized = !showUnrecognized">
        <i
          class="fas fa-fw"
          :class="showUnrecognized ? 'fa-caret-down' : 'fa-caret-right'"
        />
        有 {{ unrecognized.length }} 行词缀未识别，结果可能不完整
      </button>
      <ul v-if="showUnrecognized" class="mt-1 pl-5 text-gray-400 text-xs">
        <li v-for="line of unrecognized" :key="line.line">
          {{ line.text }}
        </li>
      </ul>
    </div>

    <div v-if="!slot" class="text-gray-400">
      这件装备不能装到当前 BD 的任何槽位。
    </div>
    <template v-else>
      <div class="rounded px-2 py-1 bg-gray-900" :class="trendClass(slotTrend)">
        {{ slot.summary }}
      </div>

      <div v-if="result.slots.length > 1" class="flex flex-wrap gap-1">
        <button
          v-for="s of result.slots"
          :key="s.slot"
          class="px-2 rounded"
          :class="
            s.slot === slot.slot
              ? 'bg-gray-600 text-gray-100'
              : 'bg-gray-900 text-gray-400 hover:text-gray-200'
          "
          @click="selected = s.slot"
        >
          {{ s.label }}
          <span :class="trendClass(dpsTrendOf(s))">{{ dpsBrief(s) }}</span>
        </button>
      </div>

      <div class="text-gray-400">
        <template v-if="slot.replaced"
          >替换{{ slot.label }}：<span class="text-gray-200">{{
            slot.replaced
          }}</span></template
        >
        <template v-else>{{ slot.label }}当前为空</template>
        <div v-for="d of slot.displaced" :key="d.slot" class="text-red-400">
          会挤掉{{ d.label }}：{{ d.name }}
        </div>
      </div>

      <table class="w-full">
        <tbody>
          <tr>
            <td class="text-gray-400 pr-2">DPS</td>
            <td class="text-right">{{ num(slot.dps.after) }}</td>
            <td class="text-right pl-2" :class="trendClass(dpsTrend)">
              {{ arrow(dpsTrend) }} {{ signed(slot.dps.absolute) }}
              <template v-if="slot.dps.percent !== null"
                >（{{ slot.dps.percent > 0 ? "+" : ""
                }}{{ slot.dps.percent.toFixed(1) }}%）</template
              >
            </td>
          </tr>
          <tr v-for="m of METRICS" :key="m.key">
            <td class="text-gray-400 pr-2">{{ m.label }}</td>
            <td class="text-right">{{ num(after(m.key)) }}</td>
            <td
              class="text-right pl-2"
              :class="trendClass(trend(slot.delta[m.key]))"
            >
              {{ arrow(trend(slot.delta[m.key])) }}
              {{ signed(slot.delta[m.key]) }}
            </td>
          </tr>
          <tr v-for="r of resists" :key="r.label">
            <td class="text-gray-400 pr-2">{{ r.label }}</td>
            <td class="text-right">
              {{ r.value }}%<span class="text-gray-500"> / {{ r.max }}%</span>
            </td>
            <td class="text-right pl-2" :class="trendClass(trend(r.change))">
              {{ arrow(trend(r.change)) }} {{ signed(r.change) }}
              <span v-if="r.overcap > 0" class="text-gray-400"
                >（溢出 {{ r.overcap }}）</span
              >
            </td>
          </tr>
        </tbody>
      </table>

      <div>
        <span class="text-gray-400">属性需求：</span>
        <span v-if="!gaps.some((g) => g.after > 0)" class="text-gray-300"
          >满足<template v-if="gaps.some((g) => g.before > 0)">
            <span class="text-green-400">▲ 补齐了原有缺口</span></template
          ></span
        >
        <span
          v-for="g of gaps.filter((g) => g.after > 0 || g.before > 0)"
          :key="g.label"
          class="mr-2"
          :class="trendClass(trend(g.before - g.after))"
        >
          {{ g.label }}缺 {{ g.after
          }}<template v-if="g.after !== g.before"
            >（{{ arrow(trend(g.before - g.after)) }}
            {{ signed(g.after - g.before) }}）</template
          >
        </span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  type EvalResult,
  type EvalSlot,
  type Trend,
  num,
  signed,
  trend,
} from "./eval-result";

const props = defineProps<{ result: EvalResult }>();

const METRICS = [
  { key: "TotalEHP", label: "有效生命" },
  { key: "Life", label: "生命" },
  { key: "EnergyShield", label: "能量护盾" },
  { key: "Mana", label: "魔力" },
] as const;

const selected = ref<string | null>(null);
const showUnrecognized = ref(false);
watch(
  () => props.result,
  (result) => {
    selected.value = result.default_slot;
    showUnrecognized.value = false;
  },
  { immediate: true },
);

const slot = computed<EvalSlot | undefined>(
  () =>
    props.result.slots.find((s) => s.slot === selected.value) ??
    props.result.slots[0],
);
const unrecognized = computed(() => props.result.item.unrecognized ?? []);
const resists = computed(() => Object.values(slot.value!.resists));
const gaps = computed(() => Object.values(slot.value!.attribute_gaps));
const dpsTrend = computed(() => dpsTrendOf(slot.value!));
// Same verdict as the summary: DPS first, then effective life.
const slotTrend = computed<Trend>(() =>
  dpsTrend.value !== "same"
    ? dpsTrend.value
    : trend(slot.value!.delta.TotalEHP),
);

const nameClass = computed(() => {
  switch (props.result.item.rarity) {
    case "Unique":
      return "text-unique";
    case "Rare":
      return "text-rare";
    case "Magic":
      return "text-magic";
    default:
      return "text-normal";
  }
});

function after(key: string): number {
  return slot.value!.metrics[key] as number;
}

// DPS changes that round to 0.0% count as unchanged, like the summary.
function dpsTrendOf(s: EvalSlot): Trend {
  return s.dps.percent !== null
    ? trend(s.dps.percent * 10)
    : trend(s.dps.absolute);
}

function dpsBrief(s: EvalSlot): string {
  if (s.dps.percent !== null) {
    return `${s.dps.percent > 0 ? "+" : ""}${s.dps.percent.toFixed(1)}%`;
  }
  return signed(s.dps.absolute);
}

function arrow(t: Trend): string {
  return t === "up" ? "▲" : t === "down" ? "▼" : "";
}

function trendClass(t: Trend): string {
  return t === "up"
    ? "text-green-400"
    : t === "down"
      ? "text-red-400"
      : "text-gray-400";
}
</script>
