<script setup lang="ts">
/**
 * 単体の詳細画面。
 *
 * 画面が広いときは一覧の右側に詳細を並べる（`/items`）ため、
 * こちらは狭い画面からの遷移と、URL 直接指定・共有のための入口。
 *
 * 幅は日記と同じ「長文」の扱いにする。作業記録は日記と同じくらいの
 * 分量を書くので、既定の 40rem では PC で入力欄が狭い。分割表示の
 * 詳細（76rem から一覧の 22rem を引いた残り）ともおおむね揃う。
 */
definePageMeta({ wide: 'reading' })

const route = useRoute()
const id = computed(() => String(route.params.id))

useHead({ title: 'タスク' })
</script>

<template>
  <ItemDetail :item-id="id" />
</template>
