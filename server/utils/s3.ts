import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

/**
 * 画像は S3 に置く（docs/03-functional-spec.md 3.5）。
 *
 * バケットはパブリックアクセスを全ブロックし、読み書きとも
 * 署名付き URL で行う。Vercel の Function を画像バイナリが
 * 通過しないよう、アップロードもダウンロードもブラウザから
 * S3 へ直接つなぐ。
 */

/** アップロード用 URL の有効期限。書き始めるまでの猶予として長めに取る。 */
const UPLOAD_URL_TTL_SECONDS = 5 * 60

/**
 * 表示用 URL を作り直す間隔（「窓」）。
 *
 * 署名付き URL は署名した時刻が入るため、毎回作ると**同じ画像でも URL が
 * 毎回変わる**。ブラウザから見れば別の資源なので、一度読んだ画像でも
 * 読み直しになり、表示のたびに待たされる。
 *
 * そこで署名の時刻をこの幅で丸め、**同じ窓の間は同じ URL** になるようにする。
 * こうすると2回目からはブラウザの持っているものがそのまま出る。
 */
const VIEW_URL_WINDOW_SECONDS = 60 * 60

/**
 * 表示用 URL の有効期限。窓の幅より長く取る。
 *
 * 窓の終わり際に受け取った URL でも、しばらくは使えるようにするため
 * （署名の時刻は窓の頭に丸めてあるので、期限も窓の頭から数える）。
 */
const VIEW_URL_TTL_SECONDS = 2 * VIEW_URL_WINDOW_SECONDS

/**
 * 画像そのものをブラウザに持たせておく時間。
 *
 * 画像は書き換わらない（ファイル名が中身ごとに違う）ので長く持たせてよい。
 * 個人のものなので `private`（間に入るキャッシュには持たせない）。
 */
const VIEW_CACHE_CONTROL = 'private, max-age=86400'

/** S3 のオブジェクトキー。本文のパスから一意に決まる形にする。 */
export function objectKeyFor(fileName: string): string {
  return `images/${fileName}`
}

interface S3Config {
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  /** MinIO 等を使う場合のみ。通常は未設定。 */
  endpoint?: string
}

function readConfig(): S3Config {
  const bucket = process.env.S3_BUCKET
  const region = process.env.S3_REGION
  const accessKeyId = process.env.S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY

  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    throw createError({
      statusCode: 503,
      message:
        '画像の保存先が設定されていません（S3_BUCKET / S3_REGION / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY）',
    })
  }

  return {
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    endpoint: process.env.S3_ENDPOINT,
  }
}

let client: S3Client | undefined
let clientBucket: string | undefined

function useS3(): { client: S3Client; bucket: string } {
  const config = readConfig()

  if (!client || clientBucket !== config.bucket) {
    client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      /*
       * 署名付き URL には本文のチェックサムを載せない。
       *
       * 既定（WHEN_SUPPORTED）だと、SDK が PutObject に CRC32 を付ける。
       * ここでは本文を渡さずに署名するため、その値は「空データの CRC32」に
       * なり、クエリ（x-amz-checksum-crc32）へ入ってしまう。
       * ブラウザが実ファイルを PUT すると S3 が突き合わせて弾く。
       *
       * MinIO は検証しないので、この不整合はローカルでは表に出ない。
       */
      requestChecksumCalculation: 'WHEN_REQUIRED',
      ...(config.endpoint
        ? { endpoint: config.endpoint, forcePathStyle: true }
        : {}),
    })
    clientBucket = config.bucket
  }

  return { client, bucket: config.bucket }
}

/** ブラウザから S3 へ直接 PUT するための URL。 */
export async function presignUpload(
  key: string,
  contentType: string,
): Promise<string> {
  const { client, bucket } = useS3()
  return await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS },
  )
}

/** 署名の時刻を丸める先（窓の頭）。同じ窓なら同じ URL になる。 */
export function viewUrlWindowStart(now: Date = new Date()): Date {
  const window = VIEW_URL_WINDOW_SECONDS * 1000
  return new Date(Math.floor(now.getTime() / window) * window)
}

/**
 * いまの窓が終わるまでの秒数。
 *
 * `/images/...` の応答（リダイレクト）をブラウザに持たせておく時間に使う。
 * 窓が変われば URL も変わるので、そこで訊き直してもらう。
 */
export function viewUrlCacheSeconds(now: Date = new Date()): number {
  const elapsed = (now.getTime() - viewUrlWindowStart(now).getTime()) / 1000
  return Math.max(1, Math.round(VIEW_URL_WINDOW_SECONDS - elapsed))
}

/**
 * 画像を表示するための、期限つきの取得 URL。
 *
 * **同じ窓の間は同じ URL を返す**（`viewUrlWindowStart`）。あわせて、
 * 応答に `Cache-Control` を付けるよう S3 へ指示する（`response-cache-control`）。
 * バケットに何も設定しなくても、ブラウザが画像を持っていられるようにするため。
 */
export async function presignView(
  key: string,
  now: Date = new Date(),
): Promise<string> {
  const { client, bucket } = useS3()
  return await getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseCacheControl: VIEW_CACHE_CONTROL,
    }),
    { expiresIn: VIEW_URL_TTL_SECONDS, signingDate: viewUrlWindowStart(now) },
  )
}
