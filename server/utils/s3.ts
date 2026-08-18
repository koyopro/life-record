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
 * 表示用 URL の有効期限。
 *
 * 本文には有効期限つき URL を書かない（`/images/...` を書く）ので、
 * ここは1回の表示が終わるまで持てばよい。
 */
const VIEW_URL_TTL_SECONDS = 5 * 60

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

/** 画像を表示するための、期限つきの取得 URL。 */
export async function presignView(key: string): Promise<string> {
  const { client, bucket } = useS3()
  return await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: VIEW_URL_TTL_SECONDS },
  )
}
