<script setup lang="ts">
import { iconNameFromFileName, normalizeIconName } from '~~/shared/types/icon'

/**
 * 自分で登録したアイコンの管理（docs/11-scrapbox-notation.md 11.8）。
 *
 * 画像を選んで名前を付けると、本文で `:name:` と書けるようになる。
 * 画像そのものは本文中の画像と同じ経路で S3 へ送る。
 */

useHead({ title: 'アイコン' })

const { icons, pending, create, remove } = useIcons()
const { upload, uploading, errorMessage: uploadError } = useImageUpload()

const fileEl = ref<HTMLInputElement | null>(null)
const file = ref<File | null>(null)
const name = ref('')
const errorMessage = ref<string | null>(null)
const saving = ref(false)

/** 選んだ画像の見た目。送る前に確かめられるようにする。 */
const preview = ref<string | null>(null)

watch(file, (value, previous) => {
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = value ? URL.createObjectURL(value) : null
  if (previous || !value) return
})

onBeforeUnmount(() => {
  if (preview.value) URL.revokeObjectURL(preview.value)
})

function onPick(event: Event) {
  const picked = (event.target as HTMLInputElement).files?.[0] ?? null
  file.value = picked
  errorMessage.value = null

  // 名前をまだ書いていなければ、ファイル名から埋めておく
  if (picked && !name.value) name.value = iconNameFromFileName(picked.name) ?? ''
}

const normalized = computed(() => normalizeIconName(name.value))

/** すでに同じ名前がある。登録すると画像が差し替わる。 */
const replacing = computed(() =>
  normalized.value
    ? (icons.value.find((icon) => icon.name === normalized.value) ?? null)
    : null,
)

const canSubmit = computed(
  () => Boolean(file.value) && Boolean(normalized.value) && !saving.value,
)

async function submit() {
  const picked = file.value
  const iconName = normalized.value
  if (!picked || !iconName) return

  saving.value = true
  errorMessage.value = null

  try {
    const path = await upload(picked)
    if (!path) {
      errorMessage.value = uploadError.value ?? '画像を保存できませんでした'
      return
    }
    await create(iconName, path)

    file.value = null
    name.value = ''
    if (fileEl.value) fileEl.value.value = ''
  } catch (e) {
    errorMessage.value = messageOf(e)
  } finally {
    saving.value = false
  }
}

async function onRemove(id: string, iconName: string) {
  if (!confirm(`「:${iconName}:」を削除します。本文に書いた :${iconName}: は文字のまま残ります。`)) {
    return
  }

  errorMessage.value = null
  try {
    await remove(id)
  } catch (e) {
    errorMessage.value = messageOf(e)
  }
}

function messageOf(e: unknown): string {
  const data = (e as { data?: { message?: string } })?.data
  return data?.message ?? '登録できませんでした'
}
</script>

<template>
  <div class="page">
    <h1 class="page__title">アイコン</h1>
    <p class="page__lead">
      登録した画像は、本文で <code>:name:</code> と書くと出せます
      （<code>:</code> を打つと候補が出ます）。
    </p>

    <form class="add" @submit.prevent="submit">
      <div class="add__row">
        <!-- 選んだ画像は、実際に出る大きさの見当が付くよう小さく出す -->
        <span class="add__preview">
          <img v-if="preview" class="add__preview-image" :src="preview" alt="" />
          <span v-else class="add__preview-empty" aria-hidden="true">＋</span>
        </span>

        <div class="add__fields">
          <input
            ref="fileEl"
            class="add__file"
            type="file"
            accept="image/*"
            aria-label="アイコンの画像"
            @change="onPick"
          />
          <label class="add__name">
            <span class="add__colon" aria-hidden="true">:</span>
            <input
              v-model="name"
              type="text"
              class="add__name-input"
              placeholder="name"
              aria-label="アイコンの名前"
              autocapitalize="off"
              autocomplete="off"
              spellcheck="false"
            />
            <span class="add__colon" aria-hidden="true">:</span>
          </label>
        </div>

        <button type="submit" class="add__submit" :disabled="!canSubmit">
          {{ saving || uploading ? '登録中…' : '登録' }}
        </button>
      </div>

      <p v-if="errorMessage" class="add__error" role="alert">{{ errorMessage }}</p>
      <p v-else-if="name && !normalized" class="add__note">
        名前に使えるのは英数字・<code>_</code>・<code>-</code> で、32文字までです。
      </p>
      <p v-else-if="replacing" class="add__note">
        「:{{ replacing.name }}:」はすでにあります。登録すると画像が差し替わります。
      </p>
    </form>

    <p v-if="pending && !icons.length" class="page__placeholder">読み込み中…</p>

    <p v-else-if="!icons.length" class="page__placeholder">
      まだアイコンはありません。画像を選んで名前を付けると、ここに並びます。
    </p>

    <ul v-else class="icons">
      <li v-for="icon in icons" :key="icon.id" class="icons__row">
        <img class="icons__image" :src="icon.path" :alt="`:${icon.name}:`" loading="lazy" />
        <code class="icons__name">:{{ icon.name }}:</code>
        <button
          type="button"
          class="icons__remove"
          :aria-label="`「:${icon.name}:」を削除`"
          @click="onRemove(icon.id, icon.name)"
        >
          削除
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.page {
  display: grid;
  /* 列は必ず親の幅に収める（中身の最小幅で広がらないようにする） */
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
}

.page__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
}

.page__lead {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.875rem;
  line-height: 1.6;
}

.page__placeholder {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.9375rem;
}

.add {
  display: grid;
  gap: 0.5rem;
  padding: 0.75rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.add__row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.add__preview {
  flex-shrink: 0;
  width: 2.75rem;
  height: 2.75rem;
  display: grid;
  place-items: center;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-muted);
}

.add__preview-image {
  max-width: 2rem;
  max-height: 2rem;
  object-fit: contain;
}

.add__fields {
  flex: 1;
  min-width: 0;
  display: grid;
  /* ファイル選択の固有幅で列が広がらないようにする */
  grid-template-columns: minmax(0, 1fr);
  gap: 0.375rem;
}

.add__file {
  font-size: 0.8125rem;
  color: var(--text-muted);
  /* 選択ボタンとファイル名の固有幅で、行を押し広げない */
  min-width: 0;
  max-width: 100%;
}

.add__name {
  display: flex;
  align-items: center;
  gap: 0.125rem;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0 0.5rem;
  min-height: 2.5rem;
}

.add__colon {
  color: var(--text-muted);
}

.add__name-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 0;
  color: var(--text);
  font: inherit;
  /* iOS でフォーカス時に自動ズームされないよう 16px を保つ */
  font-size: 1rem;
  padding: 0;
}

.add__name-input:focus {
  outline: none;
}

.add__submit {
  flex-shrink: 0;
  min-height: 2.75rem;
  padding: 0 1.25rem;
  border: 0;
  border-radius: 8px;
  background: var(--accent);
  color: var(--accent-text);
  font-weight: 600;
}

.add__submit:disabled {
  opacity: 0.5;
}

.add__note {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.8125rem;
  line-height: 1.5;
}

.add__error {
  margin: 0;
  color: var(--danger);
  font-size: 0.8125rem;
}

.icons {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.375rem;
}

.icons__row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  min-height: 2.75rem;
  padding: 0 0.75rem;
}

.icons__image {
  width: 1.5rem;
  height: 1.5rem;
  object-fit: contain;
  flex-shrink: 0;
}

.icons__name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 0.875rem;
}

.icons__remove {
  flex-shrink: 0;
  background: transparent;
  border: 0;
  color: var(--text-muted);
  min-height: 2.75rem;
  padding: 0 0.25rem;
  font-size: 0.8125rem;
}
</style>
