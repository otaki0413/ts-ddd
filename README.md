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

`.env`の2種類のパスワードをそれぞれローカル専用の値へ変更し、対応するURLにも同じ値を設定してください。URLの予約文字を含むパスワードはURL内でパーセントエンコードします。`.env`はGit管理外です。既存の`.env`やDBのパスワードを上書きしないでください。

DB接続はサーバー専用の`DATABASE_URL`、テストは`TEST_DATABASE_URL`を使います。`VITE_*`には置きません。開発DBは`127.0.0.1:55432/ts_ddd`、テストDBは`127.0.0.1:55433/ts_ddd_test`です。既存の5432番ポートのDBは使いません。

```shell
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

DBだけをDocker上のPostgreSQL 18.4で動かし、APIはホストのNode.js上で実行します。APIは`http://127.0.0.1:5173`で待ち受けます。初回はイメージ取得が必要です。`db:up`はDBが接続可能になるまで待ちます。マイグレーションもシードも繰り返し実行できます。シードは利用可能な`EQ-001`と`EQ-002`を追加し、既存の機材状態は上書きしません。

開発DBのデータはComposeの`development-data`ボリュームに残ります。APIはCtrl-C、DBは`pnpm db:stop`で停止します。再開時は`pnpm db:up`と`pnpm dev`を実行してください。Vite設定が接続プールを1つ所有し、サーバー終了時に閉じます。HTTP要求やアプリケーションエントリの再評価ではプールを作りません。

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

エラーは`{"reason":"..."}`を返します。不正な入力・期間・過去の開始は`400`、機材や予約が存在しない場合は`404`、利用停止や予約重複は`409`、JSON以外のContent-Typeは`415`、技術的な異常は`500`です。詳細な契約は[Issue #15](https://github.com/otaki0413/ts-ddd/issues/15)を参照してください。利用者IDの認証やマスタ照会は行いません。

## 検証

```shell
pnpm check
pnpm test:db:up
pnpm test:db
TZ=America/Los_Angeles pnpm test:db
pnpm test:db:stop
```

`pnpm check`はDB不要の既存テストと、Vite・Drizzle設定および実DBテストを含む型検査・整形・TypeScriptビルドを実行します。Drizzleの未使用DBドライバーへの型参照など、依存ライブラリ内部の宣言ファイルは`skipLibCheck`の対象にします。プロジェクトのソースと設定はstrictのまま検査します。実DBテストは別コマンドです。DBが起動していない場合にスキップせず失敗します。`pnpm test:db -t 'テスト名'`で絞り込めます。

実DBテストは専用の`ts_ddd_test`へマイグレーションを適用し、そのDBの機材・予約をテストごとに初期化します。接続先のホスト・ポート・DB名・ユーザーを検査し、開発DBへ接続する設定では実行しません。テストDBは専用コンテナのtmpfsに置き、停止するとデータが失われます。同じテストDBを使うテストコマンドは同時に実行しないでください。

主な検証境界はHonoのHTTP要求から既存ユースケース、実Drizzleアダプタ、PostgreSQLまでです。Viteの実設定も一時ポートで起動し、作成・読み戻し・JSONエラーを確認します。同時予約では両方の事前確認を待ち合わせ、独立した接続がDB上でロック待ちすることを観測してから解放し、成立件数を確認します。時刻境界ではテスト専用スキーマのDB時計を制御します。通常のテストと開発APIでは実際の`clock_timestamp()`を使い、アプリの時計だけの固定で代用しません。遅延制約の障害注入もテストDB内だけで行います。

## 保存と保証の範囲

同じ機材の行をロックし、別のSQLで最新の予約を読み、DB時計で再判定してから条件付きINSERTします。すべての予約作成が`ReservationCommitter`を通ることが保証の前提です。DBへ直接予約をINSERTする経路は用意していません。

判定時点はINSERTの時刻条件評価時です。commit前の失敗はロールバックし、commit成功後にだけ`201`を返します。ただしcommit応答を失った通信障害では保存結果が不明なことがあり、`500`を必ず「未保存」とは解釈できません。自動再試行や冪等性キーはありません。取消・貸出・返却・利用停止・利用再開の永続化と、これらの操作を含む排他設計は対象外です。

## コマンド

| コマンド                                | 用途                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm dev`                              | `.env`を読み、ViteでHono APIを起動する                                 |
| `pnpm build`                            | `dist`にJavaScriptを出力する（HTTPサーバーの起動・配布ビルドではない） |
| `pnpm test`                             | テストを実行する。監視時は`--watch`を付ける                            |
| `pnpm lint`                             | 静的解析と型検査を行う。修正時は`--fix`を付ける                        |
| `pnpm format`                           | ファイルを整形する。確認のみなら`--check`を付ける                      |
| `pnpm check`                            | lint・型、format、テスト、ビルドをまとめて確認する                     |
| `pnpm db:up` / `pnpm db:stop`           | 開発DBの起動・停止                                                     |
| `pnpm db:generate`                      | スキーマ変更からマイグレーションSQLを生成する                          |
| `pnpm db:migrate` / `pnpm db:seed`      | 開発DBへのマイグレーション適用・機材シード                             |
| `pnpm test:db:up` / `pnpm test:db:stop` | 専用テストDBの起動・停止                                               |
| `pnpm test:db`                          | HTTP境界から実DBまでを検証する                                         |

## ドキュメント

- [CONTEXT.md](CONTEXT.md) — 業務用語とその関係
- [技術スタック](docs/adr/0010-technology-stack.md) — 採用する技術とその理由・責務
- [予約の原子的な確定](docs/adr/0011-atomic-reservation-commit-with-postgresql.md) — 排他方式と保証の成立条件
- [設計判断一覧](docs/adr/) — 集約や業務上の境界についての判断
- [GitHub Issues](https://github.com/otaki0413/ts-ddd/issues) — 各機能の実装範囲・仕様・受入条件
