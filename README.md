# ts-ddd

TypeScript とドメイン駆動設計（DDD）を実践しながら、機材予約・貸出管理アプリを作るプロジェクトです。

機材の予約・予約取消、貸出・返却確認、利用停止・利用再開と状態・履歴照会のドメインモデルとアプリケーションサービスを実装しています。HTTPとDBに接続しているのは**予約作成と予約IDによる読み戻しだけ**です。HonoをViteで起動し、Drizzleを経由してPostgreSQLへ保存します。画面・認証・本番公開は扱いません。

## 必要な環境

- Node.js 24 以上
- pnpm 11 以上
- Docker EngineとDocker Compose（起動済み）
- APIの確認例ではcurlとjq

## セットアップ

```shell
pnpm install
cp -n .env.example .env
```

`.env`のパスワードをローカル専用の値へ変え、対応するURLにも同じ値を入れてください。接続先、スキーマ反映、シードの注意は[ローカル開発](docs/local-dev.md)を参照してください。

```shell
pnpm db:up
pnpm db:push
pnpm db:seed
pnpm dev
```

APIは`http://127.0.0.1:5173`で待ち受けます。停止はAPIがCtrl-C、DBが`pnpm db:stop`です。

## 予約を作成して読み戻す

別のターミナルから実行します。日時は`Asia/Tokyo`の`YYYY-MM-DDTHH:mm`です。

```shell
created=$(curl --fail-with-body -sS http://127.0.0.1:5173/reservations \
  -H 'Content-Type: application/json' \
  -d '{"userId":"user-1","managementNumber":"EQ-001","startsAt":"2099-09-01T10:00","endsAt":"2099-09-01T11:00"}')
printf '%s\n' "$created" | jq .
reservation_id=$(printf '%s\n' "$created" | jq -r .id)
curl --fail-with-body -sS "http://127.0.0.1:5173/reservations/$reservation_id" | jq .
```

作成は`201`と`Location: /reservations/<予約ID>`、読み戻しは`200`を返します。どちらも`id`、`userId`、`managementNumber`、`startsAt`、`endsAt`を持つJSONです。APIを再起動しても同じ予約IDで読み戻せます。同じ例をもう一度作成すると重複として`409`になります。別の予約を試す場合は時間帯か機材を変えてください。

エラーは`{"reason":"..."}`を返します。不正な入力・期間・過去の開始は`400`、機材や予約が存在しない場合は`404`、利用停止や予約重複は`409`、JSON以外のContent-Typeは`415`、技術的な異常は`500`です。詳細な契約は[Issue #15](https://github.com/otaki0413/ts-ddd/issues/15)を参照してください。利用者IDの認証やマスタ照会は行いません。予約作成の排他と保証は[ADR-0011](docs/adr/0011-atomic-reservation-commit-with-postgresql.md)を参照してください。

## 検証

```shell
pnpm check
pnpm test:db:up
pnpm test:db
TZ=America/Los_Angeles pnpm test:db
pnpm test:db:stop
```

`pnpm check`はlint・型検査・整形と、DB不要のテストを実行します。実DBテストは別コマンドです。接続先の検査や隔離の詳細は[ローカル開発](docs/local-dev.md)を参照してください。

## コマンド

| コマンド                                | 用途                                               |
| --------------------------------------- | -------------------------------------------------- |
| `pnpm dev`                              | `.env`を読み、ViteでHono APIを起動する             |
| `pnpm test`                             | テストを実行する。監視時は`--watch`を付ける        |
| `pnpm lint`                             | 静的解析と型検査を行う。修正時は`--fix`を付ける    |
| `pnpm format`                           | ファイルを整形する。確認のみなら`--check`を付ける  |
| `pnpm check`                            | lint・型、format、テストをまとめて確認する         |
| `pnpm db:up` / `pnpm db:stop`           | 開発DBの起動・停止                                 |
| `pnpm db:push`                          | `.env`を読み、TypeScriptスキーマを開発DBへ反映する |
| `pnpm db:seed`                          | 開発DBへ機材をシードする                           |
| `pnpm test:db:up` / `pnpm test:db:stop` | 専用テストDBの起動・停止                           |
| `pnpm test:db`                          | HTTP境界から実DBまでを検証する                     |

## ドキュメント

- [CONTEXT.md](CONTEXT.md) — 業務用語とその関係
- [ローカル開発](docs/local-dev.md) — 接続先、スキーマ反映、実DB検証
- [技術スタック](docs/adr/0010-technology-stack.md) — 採用する技術と選定理由
- [バックエンドの構成](docs/adr/0012-backend-layered-directory-structure.md) — 4層の責務・依存方向とComposition Root
- [予約の原子的な確定](docs/adr/0011-atomic-reservation-commit-with-postgresql.md) — 排他方式と保証の成立条件
- [設計判断一覧](docs/adr/) — 集約や業務上の境界についての判断
- [GitHub Issues](https://github.com/otaki0413/ts-ddd/issues) — 各機能の実装範囲・仕様・受入条件
