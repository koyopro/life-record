/**
 * ログインのパスワードから AUTH_PASSWORD_HASH を作る（docs/19-auth.md）。
 *
 *   npm run auth:hash
 *
 * パスワードは画面に出さずに読み、ハッシュだけを出す。出てきた値を
 * Vercel の環境変数 AUTH_PASSWORD_HASH に入れる。
 */
import { stdin, stdout } from 'node:process'
import { hashPassword } from '../server/auth/core'

async function readHidden(prompt: string): Promise<string> {
  stdout.write(prompt)
  // 端末なら入力を表示しない。パイプで渡されたときはそのまま読む
  if (!stdin.isTTY) {
    const chunks: Buffer[] = []
    for await (const chunk of stdin) chunks.push(chunk as Buffer)
    stdout.write('\n')
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')
  }
  stdin.setRawMode(true)
  stdin.resume()
  stdin.setEncoding('utf8')
  let value = ''
  return await new Promise((resolve) => {
    stdin.on('data', (key: string) => {
      if (key === '\u0003') process.exit(130)
      if (key === '\r' || key === '\n') {
        stdin.setRawMode(false)
        stdin.pause()
        stdout.write('\n')
        resolve(value)
      } else if (key === '\u007f') {
        value = value.slice(0, -1)
      } else {
        value += key
      }
    })
  })
}

const password = await readHidden('パスワード: ')
if (password.length < 12) {
  console.error('12文字以上にしてください（総当たりに耐えるため、長いものを推奨）')
  process.exit(1)
}
if (stdin.isTTY) {
  const again = await readHidden('もう一度: ')
  if (again !== password) {
    console.error('一致しません')
    process.exit(1)
  }
}
console.log(hashPassword(password))
