<script setup lang="ts">
import type { DuePreset } from '~/utils/due'
import { parseDueExpression } from '~~/shared/utils/smart-add'

const props = defineProps<{ count: number }>()

const emit = defineEmits<{
  submit: [due: { date: Date; hasTime: boolean } | null]
  close: []
}>()

const text = ref('')
const input = ref<HTMLInputElement | null>(null)

/**
 * 入力に前方一致する候補（`tod` → 「今日」、`tom` → 「明日」）。
 *
 * 日本語入力に切り替えなくても期限を変えられるようにするためのもの。
 * 打ちながら絞り込み、`Enter` で選んでいる候補に確定する。
 */
const presets = computed(() => matchDuePresets(text.value))

/**
 * 選んでいる候補の位置。-1 は「どれも選んでいない」。
 *
 * 入力が空のうちは候補を出すだけで選ばない。開いてすぐの `Enter` で
 * 意図せず期限が入ってしまうのを避けるため。
 */
const activeIndex = ref(-1)

watch(text, (value) => {
  // 絞り込みが変わったら、押し出された候補を選んだままにしない
  activeIndex.value = value.trim() ? 0 : -1
})

const active = computed(() => presets.value[activeIndex.value] ?? null)

/** 候補一覧は途中でスクロールするので、選んだものが隠れないように追う。 */
const list = ref<HTMLUListElement | null>(null)
watch(activeIndex, async (index) => {
  if (index < 0) return
  await nextTick()
  const row = list.value?.children[index]
  row?.scrollIntoView({ block: 'nearest' })
})

/**
 * SmartAdd の `^` と同じ解釈にする。覚えることを増やさないため。
 * 「なし」「x」は SmartAdd の `^なし` / `^x` と同じく「期限を外す」の指定。
 *
 * 候補を選んでいるならその式を、選んでいないなら入力そのものを解釈する
 * （`8/25 15:00` のような候補に無い書き方も今までどおり使える）。
 */
const parsed = computed(() => {
  const expression = active.value?.expression ?? text.value.trim()
  return expression ? parseDueExpression(expression) : null
})

const preview = computed(() => {
  if (!active.value && !text.value.trim()) {
    return '「明日」「金曜」「8/25 15:00」・「なし」で外せます'
  }
  if (!parsed.value) return '日付として解釈できませんでした'
  if (parsed.value.cleared) return '期限を外します'
  return formatDue({
    dueAt: parsed.value.date.toISOString(),
    dueHasTime: parsed.value.hasTime,
  }).label
})

/** 候補の右に出す実際の日付。どの日になるのかを、選ぶ前に見せる。 */
function presetDate(preset: DuePreset): string {
  const result = parseDueExpression(preset.expression)
  if (!result || result.cleared) return ''
  return `${result.date.getMonth() + 1}月${result.date.getDate()}日`
}

function move(delta: -1 | 1) {
  const count = presets.value.length
  if (!count) return
  activeIndex.value = (activeIndex.value + delta + count) % count
}

function pick(index: number) {
  activeIndex.value = index
  submit()
}

function submit() {
  if (!parsed.value) return
  emit('submit', parsed.value.cleared ? null : parsed.value)
}

/**
 * 日本語入力の変換を確定する `Enter` まで拾ってしまわないよう、
 * 変換中は素通りさせる（ItemComposer.vue と同じ判定）。
 */
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    move(1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    move(-1)
    return
  }
  if (event.key === 'Enter') {
    if (event.isComposing || event.keyCode === 229) return
    event.preventDefault()
    submit()
  }
}

onMounted(() => input.value?.focus())
</script>

<template>
  <!--
    ダイアログは body へ出す（Teleport）。
    分割表示（PC）の詳細ペインは `position: sticky`（ListDetailSplit）で、
    sticky は**それ自身が重なりの文脈（stacking context）を作る**。その中で
    z-index を上げても、外の袖（z-index 18）や「＋」（10）より上には出られず、
    ダイアログがそれらの下に潜って隠れてしまう。body へ出せば、宣言どおりの
    重なり順（docs/03-functional-spec.md 3.1）になる。
  -->
  <Teleport to="body">
    <div class="overlay" @click.self="emit('close')">
      <form
        class="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="期限を設定"
        @submit.prevent="submit"
      >
        <h2 class="sheet__title">
          期限を設定<span v-if="props.count > 1"> ({{ props.count }}件)</span>
        </h2>

        <input
          id="due-input"
          ref="input"
          v-model="text"
          class="sheet__input"
          type="text"
          placeholder="tod / tom / 明日 / 8/25 15:00"
          autocomplete="off"
          autocapitalize="off"
          role="combobox"
          aria-controls="due-presets"
          :aria-expanded="presets.length > 0"
          :aria-activedescendant="active ? `due-preset-${activeIndex}` : undefined"
          @keydown="onKeydown"
          @keydown.esc.prevent="emit('close')"
        />

        <ul
          v-if="presets.length"
          id="due-presets"
          ref="list"
          class="sheet__list"
          role="listbox"
        >
          <li
            v-for="(preset, index) in presets"
            :id="`due-preset-${index}`"
            :key="preset.label"
            role="option"
            :aria-selected="index === activeIndex"
          >
            <button
              type="button"
              class="sheet__item"
              :class="{ 'sheet__item--active': index === activeIndex }"
              tabindex="-1"
              @mouseenter="activeIndex = index"
              @click="pick(index)"
            >
              <span>{{ preset.label }}</span>
              <span class="sheet__date">{{ presetDate(preset) }}</span>
            </button>
          </li>
        </ul>

        <p class="sheet__preview" :class="{ 'sheet__preview--invalid': text.trim() && !parsed }">
          {{ preview }}
        </p>

        <div class="sheet__actions">
          <button type="button" class="sheet__clear" @click="emit('submit', null)">
            期限を外す
          </button>
          <div class="sheet__right">
            <button type="button" class="sheet__cancel" @click="emit('close')">
              キャンセル
            </button>
            <button type="submit" class="sheet__submit" :disabled="!parsed">
              設定
            </button>
          </div>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 45%);
  display: grid;
  place-items: center;
  padding: 1rem;
  z-index: 20;
}

.sheet {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  width: min(26rem, 100%);
  padding: 1rem;
  display: grid;
  gap: 0.625rem;
}

.sheet__title {
  margin: 0;
  font-size: 1rem;
}

.sheet__input {
  font: inherit;
  /* iOS でフォーカス時に自動ズームされないよう 16px を保つ */
  font-size: 1rem;
  width: 100%;
  min-height: 2.75rem;
  padding: 0 0.75rem;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
}

/* 候補が多いときは、ダイアログごと伸びないようにここだけスクロールさせる */
.sheet__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.125rem;
  max-height: 12.5rem;
  overflow-y: auto;
}

.sheet__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  background: transparent;
  border: 0;
  border-radius: 8px;
  color: var(--text);
  min-height: 2.5rem;
  padding: 0 0.625rem;
  font: inherit;
  text-align: left;
}

.sheet__item--active {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.sheet__date {
  color: var(--text-muted);
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  flex: 0 0 auto;
}

.sheet__preview {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
  min-height: 1.25rem;
}

.sheet__preview--invalid {
  color: var(--danger);
}

.sheet__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.sheet__right {
  display: flex;
  gap: 0.5rem;
}

.sheet__clear,
.sheet__cancel {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-muted);
  min-height: 2.75rem;
  padding: 0 0.75rem;
}

.sheet__submit {
  background: var(--accent);
  color: var(--accent-text);
  border: 0;
  border-radius: 8px;
  min-height: 2.75rem;
  padding: 0 1.25rem;
  font-weight: 600;
}

.sheet__submit:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
