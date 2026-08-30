# ts-ddd

TypeScript とドメイン駆動設計（DDD）を実践しながら、機材予約・貸出管理アプリを作るプロジェクトです。

現在は機材の予約・予約取消、貸出・返却確認、利用停止・利用再開と状態・履歴照会のドメインモデルとアプリケーションサービスを実装しています。Web フレームワークとデータベースはまだ導入していません。

## 必要な環境

- Node.js 24 以上
- pnpm 11 以上

## セットアップ

```shell
pnpm install
```

## コマンド

| コマンド      | 用途                                               |
| ------------- | -------------------------------------------------- |
| `pnpm dev`    | TypeScriptの変更を監視して実行する                 |
| `pnpm build`  | `dist`にJavaScriptを出力する                       |
| `pnpm start`  | ビルド済みのJavaScriptを実行する                   |
| `pnpm test`   | テストを実行する。監視時は`--watch`を付ける        |
| `pnpm lint`   | 静的解析と型検査を行う。修正時は`--fix`を付ける    |
| `pnpm format` | ファイルを整形する。確認のみなら`--check`を付ける  |
| `pnpm check`  | lint・型、format、テスト、ビルドをまとめて確認する |

## ドキュメント

- [CONTEXT.md](CONTEXT.md) — ユビキタス言語
- [docs/adr](docs/adr/) — 設計判断

用語が固まったら `CONTEXT.md` を、覆しにくい判断が固まったら `docs/adr/` を更新します。
