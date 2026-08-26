<script setup lang="ts">
import {
  GROUP_KEYS,
  GROUP_LABELS,
  SORT_KEYS,
  SORT_LABELS,
  type GroupKey,
  type SortKey,
} from '~~/shared/types/item'
import {
  DUE_OPERATORS,
  DUE_OPERATOR_LABELS,
  LIST_VIEWS,
  LIST_VIEW_LABELS,
  SMART_LIST_NAME_MAX_LENGTH,
  isDueOperatorBare,
  normalizeSmartListName,
  type DueOperator,
  type ListView,
  type SmartListDto,
  type SmartListInput,
} from '~~/shared/types/smart-list'
import { DUE_PRESETS, type DuePreset } from '~/utils/due'
import { parseDueExpression } from '~~/shared/utils/smart-add'

/**
 * スマートリストを作る・直すフォーム（docs/08-todo-management.md 8.6）。
 *
 * 作成と編集で同じものを使う。項目は5つしかなく、別々の画面にすると
 * 「作ったあとに直せる場所が違う」ことになるため。
 */
const props = defineProps<{
  /** 直すリスト。渡さなければ新しく作る。 */
  list?: SmartListDto | null
}>()

const emit = defineEmits<{
  submit: [input: SmartListInput]
  close: []
}>()

const { tags } = useTags()

const name = ref(props.list?.name ?? '')
const tag = ref<string>(props.list?.tag ?? '')
const view = ref<ListView>(props.list?.view ?? 'open')
const groupBy = ref<GroupKey>(props.list?.groupBy ?? 'none')
const sort = ref<SortKey>(props.list?.sort ?? 'priorityDueDesc')

// --- 期限での絞り込み（RTM の due 条件） --------------------------------
//
// 「向き」と「日付の式」を分けて選ぶ。日付そのものではなく式で持つので、
// 「金曜以内」のリストは開くたびに今週の金曜として解釈し直される。

/** 絞り込まないことを表す値。`<select>` に入れるので空文字で持つ。 */
const NO_DUE = ''

const dueOperator = ref<DueOperator | typeof NO_DUE>(
  props.list?.due?.operator ?? NO_DUE,
)

/**
 * 日付の式。候補は SmartAdd の `^` と同じもの（`DUE_PRESETS`）を使う。
 *
 * 「期限なし」は向きのほうに「は空です」があるので候補から外す。
 * 同じことを2か所から指せると、どちらで指したかで結果が変わるように見える。
 */
const dueValue = ref(props.list?.due?.value || '今日')

const duePresets = computed(() =>
  DUE_PRESETS.filter((preset) => preset.expression !== 'なし'),
)

/** 日付の式が要る向きか（「期限なし」「期限あり」では選ばせない）。 */
const needsDueValue = computed(
  () => dueOperator.value !== NO_DUE && !isDueOperatorBare(dueOperator.value),
)

/** どの日になるのかを、選ぶ前に見せる（RTM と同じ）。式のままでは読み取れない。 */
function presetDate(preset: DuePreset): string {
  const result = parseDueExpression(preset.expression)
  if (!result || result.cleared) return ''
  return `${result.date.getMonth() + 1}月${result.date.getDate()}日`
}

/**
 * 日付の式の候補。
 *
 * いま無い式（前に別の書き方で保存したもの）も残す。それだけで条件を
 * 選び直せなくなるのは困る（タグの候補と同じ考え方）。
 */
const valueOptions = computed(() => {
  const options = duePresets.value.map((preset) => {
    const date = presetDate(preset)
    return {
      expression: preset.expression,
      label: date ? `${preset.label}（${date}）` : preset.label,
    }
  })

  const current = props.list?.due?.value
  if (current && !options.some((option) => option.expression === current)) {
    options.unshift({ expression: current, label: current })
  }
  return options
})

const nameEl = ref<HTMLInputElement | null>(null)

const normalized = computed(() => normalizeSmartListName(name.value))

/**
 * いま無いタグも候補に残す。
 *
 * タグが付いた Item をすべて完了にすると、そのタグは一覧（未完了だけを
 * 数える）から消える。それだけでリストの条件を選び直せなくなるのは困る。
 */
const tagOptions = computed(() => {
  const names = tags.value.map((entry) => entry.name)
  const current = props.list?.tag
  if (current && !names.includes(current)) names.unshift(current)
  return names
})

/** 送るのは中身だけ。保存そのもの（と失敗の知らせ）は呼び出し側が受け持つ。 */
function submit() {
  const trimmed = normalized.value
  if (!trimmed) return

  emit('submit', {
    name: trimmed,
    tag: tag.value || null,
    due:
      dueOperator.value === NO_DUE
        ? null
        : {
            operator: dueOperator.value,
            value: needsDueValue.value ? dueValue.value : '',
          },
    view: view.value,
    groupBy: groupBy.value,
    sort: sort.value,
  })
}

onMounted(() => {
  nameEl.value?.focus()
})
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <form
      class="sheet"
      role="dialog"
      aria-modal="true"
      :aria-label="props.list ? 'リストを編集' : 'リストを作る'"
      @submit.prevent="submit"
      @keydown.esc.prevent="emit('close')"
    >
      <h2 class="sheet__title">{{ props.list ? 'リストを編集' : 'リストを作る' }}</h2>

      <label class="field">
        <span class="field__label">名前</span>
        <input
          ref="nameEl"
          v-model="name"
          class="field__input"
          type="text"
          :maxlength="SMART_LIST_NAME_MAX_LENGTH"
          placeholder="例: 仕事の残り"
          autocomplete="off"
        />
      </label>

      <label class="field">
        <span class="field__label">タグ</span>
        <select v-model="tag" class="field__input">
          <option value="">絞り込まない</option>
          <option v-for="name in tagOptions" :key="name" :value="name">
            #{{ name }}
          </option>
        </select>
      </label>

      <!--
        期限。タグとは AND で重ねる（両方に当てはまるものだけが並ぶ）。
        向きと日付の式を分けて選ぶ（docs/08-todo-management.md 8.6）。
      -->
      <div class="field">
        <span class="field__label">期限</span>
        <div class="field__pair">
          <select v-model="dueOperator" class="field__input" aria-label="期限の条件">
            <option :value="NO_DUE">絞り込まない</option>
            <option v-for="key in DUE_OPERATORS" :key="key" :value="key">
              {{ DUE_OPERATOR_LABELS[key] }}
            </option>
          </select>
          <select
            v-if="needsDueValue"
            v-model="dueValue"
            class="field__input"
            aria-label="期限の日付"
          >
            <option
              v-for="option in valueOptions"
              :key="option.expression"
              :value="option.expression"
            >
              {{ option.label }}
            </option>
          </select>
        </div>
      </div>

      <label class="field">
        <span class="field__label">表示</span>
        <select v-model="view" class="field__input">
          <option v-for="key in LIST_VIEWS" :key="key" :value="key">
            {{ LIST_VIEW_LABELS[key] }}
          </option>
        </select>
      </label>

      <label class="field">
        <span class="field__label">グループ</span>
        <select v-model="groupBy" class="field__input">
          <option v-for="key in GROUP_KEYS" :key="key" :value="key">
            {{ GROUP_LABELS[key] }}
          </option>
        </select>
      </label>

      <label class="field">
        <span class="field__label">並び</span>
        <select v-model="sort" class="field__input">
          <option v-for="key in SORT_KEYS" :key="key" :value="key">
            {{ SORT_LABELS[key] }}
          </option>
        </select>
      </label>

      <!-- 「すべて」は状態を見ない見方。何が変わるかを選ぶ前に伝える -->
      <p v-if="view === 'all'" class="sheet__note">
        完了したものも同じ見た目で並びます（取り消し線は引きません）。
      </p>

      <div class="sheet__actions">
        <button type="button" class="sheet__cancel" @click="emit('close')">
          キャンセル
        </button>
        <button type="submit" class="sheet__submit" :disabled="!normalized">
          {{ props.list ? '保存' : '作る' }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
/*
 * 向きと日付を横に並べる。狭いときは折り返す（どちらも選択肢の文字数ぶん
 * 幅を要求するので、無理に1行へ収めると読めなくなる）。
 */
.field__pair {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.field__pair > .field__input {
  flex: 1 1 8rem;
  min-width: 0;
}

.overlay {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 45%);
  display: grid;
  place-items: center;
  padding: 1rem;
  z-index: 30;
}

.sheet {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  width: min(24rem, 100%);
  max-height: 80vh;
  overflow-y: auto;
  padding: 1rem;
  display: grid;
  gap: 0.75rem;
}

.sheet__title {
  margin: 0;
  font-size: 1rem;
}

.field {
  display: grid;
  gap: 0.25rem;
}

.field__label {
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.field__input {
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

.sheet__note {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.sheet__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.sheet__cancel,
.sheet__submit {
  font: inherit;
  min-height: 2.5rem;
  padding: 0 1rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
}

.sheet__submit {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-text);
}

.sheet__submit:disabled {
  opacity: 0.5;
}
</style>
