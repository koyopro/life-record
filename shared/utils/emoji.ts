/**
 * 本文エディタの絵文字ピッカー用データ（Notion のように `:` で候補を出す）。
 *
 * 保存されるのは常に絵文字そのもの（Unicode 文字）で、`:smile:` のような
 * ショートコードは残らない。ショートコードは検索用のキーでしかない。
 */
export interface EmojiEntry {
  char: string
  /** GitHub / Slack 等でおなじみのショートコード。検索の主なキー。 */
  name: string
  /** 追加の検索キー（日本語の呼び名など）。 */
  keywords?: string[]
}

const EMOJI: EmojiEntry[] = [
  { char: '😀', name: 'grinning', keywords: ['笑顔'] },
  { char: '😄', name: 'smile', keywords: ['笑う'] },
  { char: '😂', name: 'joy', keywords: ['笑う', '爆笑'] },
  { char: '🤣', name: 'rofl' },
  { char: '🙂', name: 'slightly_smiling_face' },
  { char: '😉', name: 'wink' },
  { char: '😊', name: 'blush' },
  { char: '😍', name: 'heart_eyes' },
  { char: '🥰', name: 'smiling_face_with_hearts' },
  { char: '😘', name: 'kissing_heart' },
  { char: '😋', name: 'yum' },
  { char: '😎', name: 'sunglasses' },
  { char: '🥳', name: 'partying_face' },
  { char: '🤔', name: 'thinking', keywords: ['考え中'] },
  { char: '🤨', name: 'raised_eyebrow' },
  { char: '😐', name: 'neutral_face' },
  { char: '😑', name: 'expressionless' },
  { char: '🙄', name: 'roll_eyes' },
  { char: '😏', name: 'smirk' },
  { char: '😣', name: 'persevere' },
  { char: '😥', name: 'disappointed_relieved' },
  { char: '😮', name: 'open_mouth' },
  { char: '🤐', name: 'zipper_mouth_face' },
  { char: '😪', name: 'sleepy' },
  { char: '😴', name: 'sleeping' },
  { char: '😌', name: 'relieved' },
  { char: '😜', name: 'stuck_out_tongue_winking_eye' },
  { char: '🤪', name: 'zany_face' },
  { char: '🤑', name: 'money_mouth_face' },
  { char: '🤗', name: 'hugs' },
  { char: '🤭', name: 'hand_over_mouth' },
  { char: '🤫', name: 'shushing_face' },
  { char: '🤥', name: 'lying_face' },
  { char: '😳', name: 'flushed' },
  { char: '🥺', name: 'pleading_face' },
  { char: '😱', name: 'scream' },
  { char: '😨', name: 'fearful' },
  { char: '😰', name: 'cold_sweat' },
  { char: '😢', name: 'cry', keywords: ['泣く'] },
  { char: '😭', name: 'sob', keywords: ['泣く'] },
  { char: '😤', name: 'triumph' },
  { char: '😠', name: 'angry', keywords: ['怒る'] },
  { char: '😡', name: 'rage', keywords: ['怒る'] },
  { char: '🤬', name: 'cursing_face' },
  { char: '🤯', name: 'exploding_head' },
  { char: '😷', name: 'mask' },
  { char: '🤒', name: 'face_with_thermometer' },
  { char: '🤕', name: 'face_with_head_bandage' },
  { char: '🤢', name: 'nauseated_face' },
  { char: '🤮', name: 'vomiting_face' },
  { char: '🤧', name: 'sneezing_face' },
  { char: '🥵', name: 'hot_face' },
  { char: '🥶', name: 'cold_face' },
  { char: '🥴', name: 'woozy_face' },
  { char: '😇', name: 'innocent' },
  { char: '🤓', name: 'nerd_face' },
  { char: '🧐', name: 'monocle_face' },
  { char: '🥱', name: 'yawning_face' },
  { char: '😬', name: 'grimacing' },
  { char: '👻', name: 'ghost' },
  { char: '💀', name: 'skull' },
  { char: '🤖', name: 'robot' },
  { char: '👽', name: 'alien' },
  { char: '💩', name: 'poop' },

  { char: '👍', name: 'thumbsup', keywords: ['いいね'] },
  { char: '👎', name: 'thumbsdown' },
  { char: '👏', name: 'clap', keywords: ['拍手'] },
  { char: '🙌', name: 'raised_hands' },
  { char: '🙏', name: 'pray', keywords: ['お願い', 'ありがとう'] },
  { char: '👋', name: 'wave', keywords: ['手を振る'] },
  { char: '🤝', name: 'handshake' },
  { char: '💪', name: 'muscle', keywords: ['筋肉'] },
  { char: '✌️', name: 'v' },
  { char: '🤞', name: 'crossed_fingers' },
  { char: '👌', name: 'ok_hand', keywords: ['オーケー'] },
  { char: '👉', name: 'point_right' },
  { char: '👈', name: 'point_left' },
  { char: '👆', name: 'point_up_2' },
  { char: '👇', name: 'point_down' },
  { char: '👊', name: 'fist_oncoming' },
  { char: '✊', name: 'fist_raised' },
  { char: '👀', name: 'eyes', keywords: ['見る'] },
  { char: '🧠', name: 'brain' },

  { char: '❤️', name: 'heart', keywords: ['ハート'] },
  { char: '🧡', name: 'orange_heart' },
  { char: '💛', name: 'yellow_heart' },
  { char: '💚', name: 'green_heart' },
  { char: '💙', name: 'blue_heart' },
  { char: '💜', name: 'purple_heart' },
  { char: '🖤', name: 'black_heart' },
  { char: '🤍', name: 'white_heart' },
  { char: '💔', name: 'broken_heart' },
  { char: '💕', name: 'two_hearts' },
  { char: '💖', name: 'sparkling_heart' },

  { char: '✅', name: 'white_check_mark', keywords: ['完了', '確認'] },
  { char: '✔️', name: 'heavy_check_mark', keywords: ['完了', '確認'] },
  { char: '❌', name: 'x', keywords: ['バツ'] },
  { char: '❓', name: 'question', keywords: ['質問'] },
  { char: '❗', name: 'exclamation', keywords: ['注意'] },
  { char: '⚠️', name: 'warning', keywords: ['注意'] },
  { char: '⭐', name: 'star', keywords: ['星'] },
  { char: '🌟', name: 'star2' },
  { char: '✨', name: 'sparkles' },
  { char: '🔥', name: 'fire', keywords: ['炎'] },
  { char: '💯', name: '100', keywords: ['完璧'] },
  { char: '💢', name: 'anger' },
  { char: '💥', name: 'boom' },
  { char: '💫', name: 'dizzy' },
  { char: '💦', name: 'sweat_drops' },
  { char: '💨', name: 'dash' },
  { char: '🎉', name: 'tada', keywords: ['お祝い'] },
  { char: '🎊', name: 'confetti_ball' },
  { char: '🎈', name: 'balloon' },
  { char: '🎁', name: 'gift' },
  { char: '🏆', name: 'trophy' },
  { char: '🥇', name: 'first_place' },
  { char: '🔔', name: 'bell' },
  { char: '🔕', name: 'no_bell' },
  { char: '⚡', name: 'zap' },
  { char: '☀️', name: 'sunny' },
  { char: '🌙', name: 'crescent_moon' },
  { char: '☁️', name: 'cloud' },
  { char: '🌧️', name: 'rain_cloud' },
  { char: '❄️', name: 'snowflake' },
  { char: '🌈', name: 'rainbow' },

  { char: '📌', name: 'pushpin' },
  { char: '📍', name: 'round_pushpin' },
  { char: '📎', name: 'paperclip' },
  { char: '📝', name: 'memo', keywords: ['メモ'] },
  { char: '📅', name: 'calendar', keywords: ['予定'] },
  { char: '🗓️', name: 'spiral_calendar' },
  { char: '⏰', name: 'alarm_clock', keywords: ['アラーム'] },
  { char: '⏱️', name: 'stopwatch' },
  { char: '🔒', name: 'lock', keywords: ['鍵'] },
  { char: '🔓', name: 'unlock' },
  { char: '🔑', name: 'key', keywords: ['鍵'] },
  { char: '💡', name: 'bulb', keywords: ['アイデア'] },
  { char: '🔍', name: 'mag', keywords: ['検索'] },
  { char: '🔧', name: 'wrench' },
  { char: '⚙️', name: 'gear' },
  { char: '📦', name: 'package' },
  { char: '💰', name: 'moneybag' },
  { char: '💳', name: 'credit_card' },
  { char: '📱', name: 'iphone' },
  { char: '💻', name: 'computer' },
  { char: '⌚', name: 'watch' },
  { char: '📷', name: 'camera' },
  { char: '📚', name: 'books', keywords: ['本'] },
  { char: '✏️', name: 'pencil2' },
  { char: '🗑️', name: 'wastebasket' },
  { char: '🚀', name: 'rocket', keywords: ['ロケット'] },

  { char: '🍎', name: 'apple' },
  { char: '🍊', name: 'orange' },
  { char: '🍌', name: 'banana' },
  { char: '🍇', name: 'grapes' },
  { char: '🍓', name: 'strawberry' },
  { char: '🍅', name: 'tomato' },
  { char: '🥑', name: 'avocado' },
  { char: '🌽', name: 'corn' },
  { char: '🍞', name: 'bread' },
  { char: '🧀', name: 'cheese' },
  { char: '🍗', name: 'poultry_leg' },
  { char: '🍕', name: 'pizza' },
  { char: '🍔', name: 'hamburger' },
  { char: '🍟', name: 'fries' },
  { char: '🌭', name: 'hotdog' },
  { char: '🍜', name: 'ramen' },
  { char: '🍣', name: 'sushi' },
  { char: '🍙', name: 'rice_ball' },
  { char: '🍰', name: 'cake' },
  { char: '🎂', name: 'birthday' },
  { char: '🍩', name: 'doughnut' },
  { char: '🍪', name: 'cookie' },
  { char: '🍫', name: 'chocolate_bar' },
  { char: '☕', name: 'coffee' },
  { char: '🍵', name: 'tea' },
  { char: '🍺', name: 'beer' },
  { char: '🍷', name: 'wine_glass' },

  { char: '🐶', name: 'dog' },
  { char: '🐱', name: 'cat' },
  { char: '🐭', name: 'mouse' },
  { char: '🐰', name: 'rabbit' },
  { char: '🦊', name: 'fox_face' },
  { char: '🐻', name: 'bear' },
  { char: '🐼', name: 'panda_face' },
  { char: '🐨', name: 'koala' },
  { char: '🦁', name: 'lion' },
  { char: '🐮', name: 'cow' },
  { char: '🐷', name: 'pig' },
  { char: '🐸', name: 'frog' },
  { char: '🐵', name: 'monkey_face' },
  { char: '🐧', name: 'penguin' },
  { char: '🐦', name: 'bird' },
  { char: '🦅', name: 'eagle' },
  { char: '🦉', name: 'owl' },
  { char: '🐴', name: 'horse' },
  { char: '🦄', name: 'unicorn' },
  { char: '🐝', name: 'bee' },
  { char: '🦋', name: 'butterfly' },
  { char: '🐢', name: 'turtle' },
  { char: '🐙', name: 'octopus' },
  { char: '🐬', name: 'dolphin' },
  { char: '🐳', name: 'whale' },

  { char: '🌸', name: 'cherry_blossom' },
  { char: '🌻', name: 'sunflower' },
  { char: '🌹', name: 'rose' },
  { char: '🌳', name: 'deciduous_tree' },
  { char: '🌲', name: 'evergreen_tree' },
  { char: '🍀', name: 'four_leaf_clover' },
  { char: '🍁', name: 'maple_leaf' },
  { char: '🌊', name: 'ocean' },
  { char: '🗻', name: 'mount_fuji' },

  { char: '⚽', name: 'soccer' },
  { char: '🏀', name: 'basketball' },
  { char: '⚾', name: 'baseball' },
  { char: '🎾', name: 'tennis' },
  { char: '🎮', name: 'video_game' },
  { char: '🎲', name: 'game_die' },
  { char: '🎯', name: 'dart' },
  { char: '🎨', name: 'art' },
  { char: '🎬', name: 'clapper' },
  { char: '🎤', name: 'microphone' },
  { char: '🎵', name: 'musical_note' },
  { char: '🚗', name: 'car' },
  { char: '🚲', name: 'bike' },
  { char: '✈️', name: 'airplane' },
  { char: '🚢', name: 'ship' },
  { char: '🏠', name: 'house' },
  { char: '🏢', name: 'office' },
  { char: '🏥', name: 'hospital' },
  { char: '🏫', name: 'school' },

  { char: '🙆', name: 'ok_woman' },
  { char: '🙅', name: 'no_good' },
  { char: '🙋', name: 'raising_hand' },
  { char: '🙇', name: 'bow' },
  { char: '🤷', name: 'shrug' },
  { char: '🤦', name: 'facepalm' },
]

/**
 * `query` に合う絵文字を、ショートコードの前方一致 → 部分一致の順で返す。
 *
 * 空クエリ（`:` を打った直後）は先頭からよく使うものを返す。
 * 配列の並び順がそのまま「よく使う順」を兼ねる。
 */
export function searchEmoji(query: string, limit = 8): EmojiEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return EMOJI.slice(0, limit)

  const starts: EmojiEntry[] = []
  const includes: EmojiEntry[] = []
  for (const entry of EMOJI) {
    const haystacks = [entry.name, ...(entry.keywords ?? [])].map((s) => s.toLowerCase())
    if (haystacks.some((h) => h.startsWith(q))) starts.push(entry)
    else if (haystacks.some((h) => h.includes(q))) includes.push(entry)
  }
  return [...starts, ...includes].slice(0, limit)
}

/**
 * アイコンを選んだときに本文へ差し込む文字列（docs/11-scrapbox-notation.md 11.8）。
 *
 * `:name:` の後ろに**半角スペースを1つ足す**。閉じの `:` が次に打つ文字と
 * くっついたままだと、候補は `:` から始まる語を見て出すため、続けて打った
 * 文字がそのまま次のアイコン名の入力として拾われてしまう。アイコンを続けて
 * 置くときも、間に区切りが要る。
 *
 * すでに後ろが空白なら足さない（押すたびに空白が増えないようにする）。
 */
export function iconInsertion(name: string, following = ''): string {
  return /^\s/.test(following) ? `:${name}:` : `:${name}: `
}
