# Repository Guidelines

## 現在の段階

このリポジトリはTypeScriptとDDDの学習用で、単一拠点の機材予約・貸出管理を題材とする。業務ルールは`docs/product-overview.md`、用語は`docs/ubiquitous-language.md`を確認し、要件を推測して空のレイヤーや未決定の機能を先に追加しない。

## 設計判断

DDDの判断基準は`docs/ddd-guidelines.md`に従う。新しい設計方針はコード内のコメントではなく、必要に応じて`docs/`配下へ記録し、READMEから参照できるようにする。

## 実装時の注意

- `NodeNext`を使用しているため、相対importにはTypeScriptソースでも`.js`拡張子を書く。
- lintと型検査は`pnpm lint`に統合されている。変更完了前に`pnpm check`を実行する。
- `src/greeting.ts`は環境確認用であり、ドメインモデルとして発展させない。
