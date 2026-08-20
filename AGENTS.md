# AGENTS.md

コーディングエージェント向けの作業方針。

## コミットとプッシュ

特に指示がない場合は、差分は随時 commit して `develop` に push する。

- まとまった単位の変更ができたらその都度 commit する。ユーザーの確認を待たない。
- 作業ブランチは `develop`。commit 後はそのまま `git push origin develop` する。
- コミットメッセージは日本語で、既存の履歴に合わせて `feat:` / `fix:` / `docs:` などの prefix を付ける。

## 動作確認

動作確認で Chrome DevTools (MCP) を使う場合、他のセッションが掴んでいる Chrome / DevTools は強制終了して構わない。

- 接続に失敗したり、別セッションのブラウザが残っている場合は、遠慮せず既存プロセスを kill してから起動し直す。
- ユーザーに「他のセッションが使っているかもしれない」と確認する必要はない。

## 参考

- 開発サーバー: `npm run dev`
- テスト: `npm run test`
- 型チェック: `npm run typecheck`
- 仕様は [docs/](docs/) を参照。
