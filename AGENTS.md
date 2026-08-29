# Repository Guidelines

## 現在の段階

TypeScript と DDD の学習用で、単一拠点の機材予約・貸出管理を題材とする。用語は `CONTEXT.md`、スコープと判断は `docs/adr/` を読む。要件を推測して空のレイヤーや未決定の機能を先に追加しない。

## 設計判断

モデルは業務の言葉が揃ってから書く。コードを置く目的がない空のレイヤーディレクトリは作らない。レイヤー構成と永続化は、モデルとユースケースが見えてから決める。新しい設計判断は `docs/adr/` に記録する。

## 実装時の注意

- `NodeNext` を使用しているため、相対 import には TypeScript ソースでも `.js` 拡張子を書く。
- lint と型検査は `pnpm lint` に統合されている。変更完了前に `pnpm check` を実行する。
- `src/greeting.ts` は環境確認用であり、ドメインモデルとして発展させない。

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.

### Ticket decomposition

`to-tickets` は、作業を複数の tracer-bullet ticket に分割する規模になった時点で追加する。それまではプロジェクトローカルにインストールしない。
