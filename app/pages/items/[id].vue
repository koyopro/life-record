<script setup lang="ts">
/**
 * 単体の詳細画面。
 *
 * 画面が広いときは一覧の右側に詳細を並べる（`/items`）ため、
 * こちらは狭い画面からの遷移と、URL 直接指定・共有のための入口。
 */
const route = useRoute()
const id = computed(() => String(route.params.id))

useHead({ title: 'タスク' })
</script>

<template>
  <ItemDetail :item-id="id" />
</template>
