# ts-ddd

TypeScript とドメイン駆動設計（DDD）を実践しながら学ぶためのプロジェクトです。

現在は TypeScript の実行・ビルド・テスト・静的解析・フォーマットを行える、フレームワーク非依存の開発環境だけを用意しています。具体的な題材、ドメインモデル、Web フレームワーク、データベースはまだ導入していません。

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

- [DDD の設計判断ガイド](docs/ddd-guidelines.md)

今後の設計判断は、テーマごとに `docs` 配下の Markdown へ追加し、この一覧から参照できるようにします。
