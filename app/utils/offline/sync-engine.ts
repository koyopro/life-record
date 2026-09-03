import type { ItemDto } from '~~/shared/types/item'
import type { LocalItem, LocalSection, PendingOperation } from './local-database'
import {
  deleteItem,
  getItem,
  markSynced,
  putConflict,
} from './todo-repository'
import {
  cancelOperations,
  enqueueOnce,
  listOperations,
  nextOperation,
  recordFailure,
  removeOperation,
  type DiarySavePayload,
  type PatchPayload,
  type TagsPayload,
  type SectionDeletePayload,
  type SectionReorderPayload,
  type SectionSavePayload,
} from './sync-queue'
import {
  deleteSection,
  getDiary,
  getSection,
  putDiary,
  putSection,
  toLocalSection,
} from './body-repository'
import { dropSectionsOfItem } from './body-actions'
import { rememberDeleted } from './deleted-snapshots'
import { runOperation, type RequestFn, type SyncOutcome } from './sync-runner'

/**
 * 列に溜まった操作を、順にサーバーへ流し込む処理。
 *
 * 画面（Vue）に依存させない。ここが同期の決まりごとの本体で、
 * 単体でも試せるようにしておきたいため。反応する状態の持ち回りと、
 * どの合図で動かすかは useSync が受け持つ。
 */

export interface EngineHooks {
  /** 実際の送信。useSync は画面からの送信と同じ列に並べて渡す。 */
  request: RequestFn
  /** ローカルの内容が変わった。画面に見せている配列を読み直させる。 */
  onLocalChange?: () => void | Promise<void>
  /**
   * 1つ送り終えた。この回で何件送ったかを画面へ出すために使う。
   *
   * 送り終えた数が伸び続けているのに未送信の数が減らなければ、同じ操作を
   * 送り直し続けている（回り続けている）ということが分かる
   * （docs/12-offline.md 12.8）。
   */
  onProgress?: (sent: number) => void
  /** サーバーへ届いたか。オフライン表示の判断に使う。 */
  onReachable?: (reachable: boolean) => void
  /** 直近の失敗の内容。 */
  onError?: (message: string | null) => void
  /** 時刻。テストから差し替える。 */
  now?: () => Date
}

export interface DrainResult {
  /** 送れた操作の数。 */
  sent: number
  /** 送れずに残った理由（あれば）。 */
  stoppedBy: 'retry' | 'empty'
}

/**
 * 列の先頭から順に送る。
 *
 * 順序を守るのは**同じ宛先（Item・日記の日付）への操作どうし**だけ
 * （`nextOperation`）。1つが送れなくなっても、関係のない宛先は送り進める。
 * 通信そのものができていないときだけ、その回をまるごと止める。
 */
export async function drainQueue(hooks: EngineHooks): Promise<DrainResult> {
  const now = hooks.now ?? (() => new Date())
  let sent = 0

  for (;;) {
    const operation = await nextOperation(now())
    if (!operation) return { sent, stoppedBy: 'empty' }

    // 送った内容そのもの（手元の最新を入れ直したもの）を、結果の反映にも使う。
    // 積んだ時点の値で判断すると、往復中に書き足された分を取りこぼす
    const sending = await withCurrentValues(operation)
    const outcome = await runOperation(sending, hooks.request)
    const stop = await applyOutcome(sending, outcome, hooks)

    if (outcome.type === 'done') {
      sent += 1
      hooks.onProgress?.(sent)
    }
    if (stop) return { sent, stoppedBy: 'retry' }
  }
}

/**
 * 送信の結果をローカルへ反映する。列を止めるべきなら true を返す。
 */
export async function applyOutcome(
  operation: PendingOperation,
  outcome: SyncOutcome,
  hooks: EngineHooks,
): Promise<boolean> {
  const now = hooks.now ?? (() => new Date())

  switch (outcome.type) {
    case 'done': {
      await removeOperation(operation.seq)
      hooks.onReachable?.(true)
      hooks.onError?.(null)

      if (isBodyOperation(operation)) {
        await applyBodyOutcome(operation, outcome)
        await hooks.onLocalChange?.()
        return false
      }

      if (operation.kind === 'delete') {
        // 取り消しで元に戻せるよう、応答の控えを覚えておく
        if (outcome.detail) rememberDeleted(outcome.detail)
        const id = operation.itemIds[0]
        const local = id ? await getItem(id) : undefined
        // 送信中に復元されていたら、その記録は消さない
        if (local?.syncState === 'pending_delete') {
          await deleteItem(local.id)
          // 宛先の無くなった作業記録を手元に残さない
          await dropSectionsOfItem(local.id)
        }
      } else if (outcome.item) {
        // 手元がまだ先へ進んでいるなら、内容は上書きしない
        // （競合の基準（baseUpdatedAt）だけ進める）
        const keepPending = await hasMoreToSend(operation, outcome.item)
        await markSynced(outcome.item, { keepPending })
      }

      await hooks.onLocalChange?.()
      return false
    }

    case 'conflict': {
      /*
       * 送ろうとした内容が、サーバーにすでに入っている。
       *
       * **1回目は届いていて、応答だけが返らなかった**ということ（通信が切れた・
       * アプリが閉じた・別のタブが同じ操作を送った）。送り直すとサーバーの
       * updatedAt が進んでいるので競合に見えるが、中身は自分が送ったもので、
       * 他の端末の変更ではない。ここで競合として扱うと**自分の変更を自分で
       * 捨てる**ことになる（続けて書いた分もまとめて取り下げられる）。
       */
      if (outcome.server && alreadyApplied(operation, outcome.server)) {
        return await applyOutcome(
          operation,
          { type: 'done', item: outcome.server },
          hooks,
        )
      }

      return await handleConflict(operation, outcome, hooks, now())
    }

    case 'retry': {
      // 消さずに残す。次に送ってよい時刻だけ後ろへ倒す
      await recordFailure(operation.seq, outcome.message, { now: now() })
      hooks.onError?.(outcome.message)

      /*
       * サーバーへ届いていないなら（通信できていない）、続けても同じなので
       * 列ごと止める。
       *
       * そうでない失敗（5xx・認証切れなど、応答は返っている）で止めると、
       * **詰まった1つの操作が関係のない変更まで止める**。次に送ってよい
       * 時刻は後ろへ倒してあり、`nextOperation` が同じ宛先の後続ごと
       * 飛ばしてくれるので、この回はほかの宛先を送り進めてよい。
       * 日記が、送れないタスクの操作の後ろで待たされない。
       */
      if (outcome.offline) {
        hooks.onReachable?.(false)
        return true
      }
      return false
    }

    case 'failed': {
      // 内容の問題なので投げ続けても通らない。印だけ付けて次へ進む
      await recordFailure(operation.seq, outcome.message, {
        permanent: true,
        now: now(),
      })
      hooks.onError?.(outcome.message)
      await hooks.onLocalChange?.()
      return false
    }
  }
}

/**
 * 送り終えた印を付けずに、手元の内容を保つべきか。
 *
 * 応答は**送った時点の姿**なので、手元がその先へ進んでいるときに当てると、
 * 書いたものが消える（入力したそばから巻き戻る）。次のどちらかなら保つ。
 *
 * 1. まだ同じ Item への操作が列に残っている。上書きすると、送信の往復中に
 *    行った変更が画面から消える
 * 2. **送った項目が、手元ではもう違う値になっている。**ローカルへ書くことと
 *    列へ積むことは別々の取引なので、書き終わっていても列にはまだ入って
 *    いない瞬間がある。1 だけを見ていると、その隙に届いた応答で塗り潰す
 *    （本文の `applyBodyOutcome` と同じ考え方）
 */
async function hasMoreToSend(
  operation: PendingOperation,
  server: ItemDto,
): Promise<boolean> {
  const remaining = await listOperations()
  if (remaining.some((rest) => rest.itemIds.includes(server.id))) return true

  // 突き合わせられるのは、送った項目が分かるもの（更新・タグ）だけ。
  // 追加・復元は「入力そのまま」を送っており、比べる相手が無い
  if (operation.kind !== 'patch' && operation.kind !== 'tags') return false

  const local = await getItem(server.id)
  return local ? !alreadyApplied(operation, local) : false
}

/**
 * 送ろうとした内容が、その写しにすでに入っているか。
 *
 * 見るのは**送った項目だけ**。他の項目が違っていても、こちらが触っていない
 * ものなので構わない。突き合わせる相手は、サーバーが返した今の内容
 * （届いていた送信の送り直しか）と、手元の内容（さらに書き足されたか）。
 */
function alreadyApplied(operation: PendingOperation, server: ItemDto): boolean {
  if (operation.kind === 'patch') {
    const { patch } = operation.payload as PatchPayload
    const current = server as unknown as Record<string, unknown>
    return Object.entries(patch).every(([key, value]) => sameValue(value, current[key]))
  }

  // タグの付け外しは集合の操作。付けたものがあり、外したものが無ければ済んでいる
  if (operation.kind === 'tags') {
    const { add, remove } = operation.payload as TagsPayload
    return (
      add.every((name) => server.tags.includes(name)) &&
      remove.every((name) => !server.tags.includes(name))
    )
  }

  return false
}

/** 送った値とサーバーの値が同じか。タグだけ配列で来るので順番を見ない。 */
function sameValue(sent: unknown, current: unknown): boolean {
  if (Array.isArray(sent) && Array.isArray(current)) {
    const a = [...sent].sort()
    const b = [...current].sort()
    return a.length === b.length && a.every((value, index) => value === b[index])
  }
  return sent === current
}

/**
 * 競合したときの処理。**新しい方を採る**（docs/12-offline.md 12.5）。
 * 列を止めるべきなら true を返す。
 *
 * 手元の変更のほうが後なら、サーバーの版を土台にして送り直す。送るのは
 * 自分が変えた項目だけなので、他の端末が変えた別の項目はそのまま残る。
 *
 * サーバーのほうが新しければサーバーを採る。ただし黙って捨てず、捨てた
 * ローカルの変更を記録して画面に出す。この Item に積まれていた未送信の操作も
 * まとめて取り下げる（サーバー側を採ると決めた以上、後続の操作を送れば同じ
 * ことを繰り返す）。
 */
async function handleConflict(
  operation: PendingOperation,
  outcome: Extract<SyncOutcome, { type: 'conflict' }>,
  hooks: EngineHooks,
  now: Date,
): Promise<boolean> {
  const itemId = operation.itemIds[0]
  if (!itemId) {
    await removeOperation(operation.seq)
    return false
  }

  const local = await getItem(itemId)

  if (outcome.server && local && isNewerThanServer(local, outcome.server)) {
    // 内容は手元のまま、競合の基準（baseUpdatedAt）だけサーバーに合わせる
    await markSynced(outcome.server, { keepPending: true })
    hooks.onReachable?.(true)
    /*
     * 送り直しは間を空ける。すぐ投げ直すと、相手が変え続けている間ずっと
     * 回り続ける。回数を数えるので、収まらなければ諦めて画面に出る。
     */
    await recordFailure(operation.seq, '他の端末の変更に合わせて送り直します', {
      now,
    })
    await hooks.onLocalChange?.()
    // 間を空けるのはこの Item だけ。関係のない宛先は続けて送る
    return false
  }

  // 本文（作業記録）の操作は取り下げない。メタデータの競合とは別で、
  // 書いたものはサーバーに無い（取り下げると手元にしか残らない）
  await cancelOperations(
    (rest) => rest.itemIds.includes(itemId) && !isBodyOperation(rest),
  )

  if (outcome.reason === 'server_deleted' || !outcome.server) {
    await deleteItem(itemId)
  } else {
    await markSynced(outcome.server)
  }

  await putConflict({
    itemId,
    title: local?.title ?? outcome.server?.title ?? '',
    detectedAt: now.toISOString(),
    discarded: discardedOf(operation),
    reason: outcome.reason,
  })

  hooks.onReachable?.(true)
  await hooks.onLocalChange?.()
  return false
}

/**
 * 手元の変更のほうが、サーバーの版より後か。
 *
 * 手元の `updatedAt` は書き換えた時刻（この端末の時計）、サーバーの
 * `updatedAt` は向こうが書き換えた時刻。**別の時計を比べる**ので、端末の
 * 時計が大きくずれていると採る側が入れ替わりうる。それでも「新しい方を採る」
 * ほうが、書いたものが黙って消えるより驚きが少ない（docs/12-offline.md 12.5）。
 */
function isNewerThanServer(local: LocalItem, server: ItemDto): boolean {
  return local.updatedAt > server.updatedAt
}

/**
 * その作業記録を**いま送るならどうなるか**。
 *
 * 送る直前に手元から取り直す値（docs/12-offline.md 12.7）を、ここだけで作る。
 * 送信の前（`withCurrentValues`）と後（`applyBodyOutcome` の食い違いの判定）で
 * 別々に組み立てると、**手元の写しと送る値の食い違いが直らない**組み合わせが
 * できてしまう。実際、ピン留めより前に書いた写し（`pinned` を持たない）は
 * 送るときだけ false に直していたため、送り終えた内容と素のまま比べると
 * 永久に食い違い、「往復中に書き足された」と見なして送り直し続けていた
 * （列が空にならず、画面は「未同期」と「同期中」のまま動かない）。
 */
function sendValuesOf(
  payload: SectionSavePayload,
  local: LocalSection,
): SectionSavePayload {
  return {
    ...payload,
    date: local.date,
    body: local.body,
    // 古い写しには無い（この機能より前に入れた分）。無ければ立っていない扱い
    pinned: local.pinned === true,
  }
}

/**
 * 送る直前に、手元の最新の値を payload へ入れ直す。
 *
 * - 競合の基準（サーバーで最後に見た updatedAt）。積んだ時点の値をそのまま
 *   使うと、同じ Item への1つ前の操作が通ってサーバーの updatedAt が
 *   進んだ時点で、自分の変更なのに競合と見なされる
 * - 本文（作業記録・日記）。打鍵のたびに操作を積まず、列には1つだけ置いて
 *   **送るときに手元から取り直す**（docs/12-offline.md 12.7）
 */
export async function withCurrentValues(
  operation: PendingOperation,
): Promise<PendingOperation> {
  if (operation.kind === 'patch') {
    const payload = operation.payload as PatchPayload
    const local = await getItem(payload.id)
    return {
      ...operation,
      payload: { ...payload, baseUpdatedAt: local?.baseUpdatedAt ?? null },
    }
  }

  if (operation.kind === 'section_save') {
    const payload = operation.payload as SectionSavePayload
    const local = await getSection(payload.id)
    if (!local) return operation
    return { ...operation, payload: sendValuesOf(payload, local) }
  }

  if (operation.kind === 'diary_save') {
    const payload = operation.payload as DiarySavePayload
    const local = await getDiary(payload.date)
    if (!local) return operation
    return { ...operation, payload: { ...payload, body: local.body } }
  }

  return operation
}

/** 本文（作業記録・日記）の操作か。Item とは結果の当て方が違う。 */
function isBodyOperation(operation: PendingOperation): boolean {
  return (
    operation.kind === 'section_save' ||
    operation.kind === 'section_delete' ||
    operation.kind === 'section_reorder' ||
    operation.kind === 'diary_save'
  )
}

/**
 * 本文を送り終えたときの後始末。
 *
 * **送った内容と手元の内容が食い違っていたら、同期済みにはしない。**
 * 送信の往復中にも書き足せるため、そのまま同期済みにすると、次に
 * サーバーから取り直したときに書き足した分が消える。列にもう一度積んで、
 * 続けて送る。
 */
async function applyBodyOutcome(
  operation: PendingOperation,
  outcome: Extract<SyncOutcome, { type: 'done' }>,
): Promise<void> {
  switch (operation.kind) {
    case 'section_save': {
      const payload = operation.payload as SectionSavePayload
      const local = await getSection(payload.id)
      if (!local) return

      const sent = outcome.section
      // 宛先が無くなっていた（404）。手元の記録も残さない
      if (!sent) {
        await deleteSection(payload.id)
        return
      }

      /*
       * 送っている間に書き足されたか。**もう一度送るなら何を送るか**で見る。
       * 送った内容と同じものを送ることになるなら、積み直しても同じ結果に
       * なるだけなので（回り続ける）、送り終えたものとして扱う。
       */
      const next = sendValuesOf(payload, local)
      if (
        next.body !== payload.body ||
        next.date !== payload.date ||
        next.pinned !== payload.pinned
      ) {
        // 位置や作成日時だけ確定させ、未送信の印は残す
        await putSection({
          ...local,
          position: sent.position,
          createdAt: sent.createdAt,
        })
        await enqueueOnce({ kind: 'section_save', itemIds: [payload.itemId], payload }, (rest) =>
          rest.kind === 'section_save' &&
          (rest.payload as SectionSavePayload).id === payload.id,
        )
        return
      }

      await putSection(toLocalSection(payload.itemId, sent))
      return
    }

    case 'section_delete': {
      const payload = operation.payload as SectionDeletePayload
      await deleteSection(payload.id)
      return
    }

    case 'section_reorder': {
      const payload = operation.payload as SectionReorderPayload
      const remaining = await listOperations()

      for (const section of outcome.sections ?? []) {
        const local = await getSection(section.id)
        if (!local) continue

        // まだ本文の保存が残っている記録は、並び順だけ受け取る。
        // 上書きすると、送信中に書いた分が消える
        const busy = remaining.some(
          (rest) =>
            (rest.kind === 'section_save' &&
              (rest.payload as SectionSavePayload).id === section.id) ||
            (rest.kind === 'section_delete' &&
              (rest.payload as SectionDeletePayload).id === section.id),
        )

        await putSection(
          busy
            ? { ...local, position: section.position }
            : toLocalSection(payload.itemId, section),
        )
      }
      return
    }

    case 'diary_save': {
      const payload = operation.payload as DiarySavePayload
      const local = await getDiary(payload.date)
      if (!local) return

      if (local.body !== payload.body) {
        await enqueueOnce({ kind: 'diary_save', itemIds: [], payload }, (rest) =>
          rest.kind === 'diary_save' &&
          (rest.payload as DiarySavePayload).date === payload.date,
        )
        return
      }

      await putDiary({
        date: payload.date,
        body: payload.body,
        updatedAt: outcome.diary?.updatedAt ?? local.updatedAt,
        syncState: 'synced',
      })
      return
    }
  }
}

/** 競合で採用しなかった内容。人が見て何を失ったか分かる形にする。 */
function discardedOf(operation: PendingOperation): Record<string, unknown> {
  if (operation.kind === 'patch') {
    return { ...(operation.payload as PatchPayload).patch }
  }
  return { operation: operation.kind }
}
