<script setup lang="ts">
/**
 * `g` `m` の行き先（`g` `s` のタグ版に合わせる）。
 *
 * 名前を打つと候補が絞り込まれ、選ぶとそのスマートリスト
 * （`/lists/:id`）へ直接移る。
 */
import { LIST_VIEW_LABELS, type SmartListDto } from '~~/shared/types/smart-list'

const emit = defineEmits<{
  select: [id: string]
  close: []
}>()

const { suggest } = useSmartLists()

const input = ref('')
const inputEl = ref<HTMLInputElement | null>(null)
const activeIndex = ref(0)

/** マッチした部分を太字にするため、前後と分けて持つ。 */
const matches = computed(() => {
  const query = input.value.trim().toLowerCase()
  return suggest(input.value)
    .slice(0, 8)
    .map((list) => {
      const index = query ? list.name.toLowerCase().indexOf(query) : -1
      if (index === -1) return { ...list, before: list.name, match: '', after: '' }
      return {
        ...list,
        before: list.name.slice(0, index),
        match: list.name.slice(index, index + query.length),
        after: list.name.slice(index + query.length),
      }
    })
})

// 絞り込みが変わったら、押し出された候補を選んだままにしない
watch(matches, () => {
  activeIndex.value = 0
})

/** 候補の右に出す短い説明。同じ名前で条件だけ違うリストを見分けるため。 */
function describe(list: SmartListDto): string {
  return [list.tag ? `#${list.tag}` : 'すべて', LIST_VIEW_LABELS[list.view]].join(' ・ ')
}

function move(delta: -1 | 1) {
  const count = matches.value.length
  if (!count) return
  activeIndex.value = (activeIndex.value + delta + count) % count
}

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
    event.preventDefault()
    const list = matches.value[activeIndex.value]
    if (list) emit('select', list.id)
  }
}

onMounted(() => {
  inputEl.value?.focus()
})
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="sheet" role="dialog" aria-modal="true" aria-label="リストに移動">
      <h2 class="sheet__title">リストに移動</h2>

      <input
        ref="inputEl"
        v-model="input"
        class="sheet__input"
        type="text"
        placeholder="リスト名で絞り込む"
        autocomplete="off"
        autocapitalize="off"
        @keydown="onKeydown"
        @keydown.esc.prevent="emit('close')"
      />

      <ul v-if="matches.length" class="sheet__list">
        <li v-for="(list, index) in matches" :key="list.id">
          <button
            type="button"
            class="sheet__item"
            :class="{ 'sheet__item--active': index === activeIndex }"
            @mouseenter="activeIndex = index"
            @click="emit('select', list.id)"
          >
            <span class="sheet__name"
              >{{ list.before }}<strong>{{ list.match }}</strong>{{ list.after }}</span
            >
            <span class="sheet__conditions">{{ describe(list) }}</span>
          </button>
        </li>
      </ul>

      <p v-else class="sheet__empty">
        {{ input ? '該当するリストがありません' : 'リストはまだありません' }}
      </p>
    </div>
  </div>
</template>

<style scoped>
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
  gap: 0.5rem;
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

.sheet__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.125rem;
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

.sheet__name {
  overflow-wrap: anywhere;
}

.sheet__name strong {
  color: var(--accent);
}

.sheet__conditions {
  color: var(--text-muted);
  font-size: 0.8125rem;
  flex: 0 0 auto;
}

.sheet__empty {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.875rem;
  padding: 0.5rem 0.625rem;
}
</style>
