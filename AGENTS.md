# Repository Guidelines

## 現在の段階

このリポジトリはTypeScriptとDDDの学習用で、具体的な題材はまだ決まっていない。要件を推測してドメインモデル、空のレイヤー、フレームワーク、DBを先に追加しない。題材とユビキタス言語を確認してから、必要な実装だけを作る。

## 設計判断

DDDの判断基準は`docs/ddd-guidelines.md`に従う。新しい設計方針はコード内のコメントではなく、必要に応じて`docs/`配下へ記録し、READMEから参照できるようにする。

## 実装時の注意

- `NodeNext`を使用しているため、相対importにはTypeScriptソースでも`.js`拡張子を書く。
- lintと型検査は`pnpm lint`に統合されている。変更完了前に`pnpm check`を実行する。
- `src/greeting.ts`は環境確認用であり、ドメインモデルとして発展させない。
