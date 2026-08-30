# 予約の原子的な確定にPostgreSQLの機材行ロックを使う

同じ機材への重複する同時予約が最大1件だけ成立するよう、`ReservationCommitter`にPostgreSQLのトランザクションと機材行ロックを採用する。[ADR-0004](./0004-separate-equipment-and-reservation-aggregates.md)の機材と予約を別集約にする設計を保ち、最新状態に対するドメインの判断と保存を原子的に行う。

## 確定の方式と成立条件

分離レベルは`READ COMMITTED`とし、管理番号で機材行を`FOR UPDATE`してから、別のSQL文で関連する予約を読み直す。予約が0件の場合にも排他が必要なため、予約行ではなく機材行をロックする。[READ COMMITTEDは文ごとにスナップショットを取得する](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED)ため、ロック取得後の読み直しで先に成立した予約を判定へ反映できる。読み取り・判定・保存は同じトランザクションの接続で行う。

ロック取得と読み直しの後にDB時計から現在日時を取得し、利用開始予定日時が過去でないことを確認して、同じ日時を既存の予約可否ポリシーへ渡す。判定後も時間は進むため、INSERT自体にも利用開始予定日時を過ぎていないことを条件として含める。現在日時には`clock_timestamp()`を使い、[トランザクション開始時刻を返す`now()`や`CURRENT_TIMESTAMP`](https://www.postgresql.org/docs/current/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT)は使わない。

予約可否の最終判定時点はINSERTの条件評価時点とし、保存とcommitが正常に完了した場合だけ成功を返す。commit完了やHTTP応答の到着時刻を予約可否の判定時点にはしない。業務上の拒否とDBの技術的な異常は区別し、commitの応答を失った場合の保存結果は不明として扱う。

保証の対象は予約作成であり、すべての予約作成がこのcommitterを通ることを前提とする。この経路を迂回した予約の書き込みは保証対象にせず、排他制約やトリガーは導入しない。予約取消・貸出・返却確認・利用停止・利用再開の排他方式は、この判断に含めない。

## 日時の保存と精度

利用開始予定日時と返却予定日時はTemporalで`Asia/Tokyo`として解釈した瞬間を、Unix epochミリ秒の`bigint`として保存する。分単位の予約日時を無損失で扱い、既存の4桁年の入力範囲をDBの日時文字列の解釈に依存させないためである。読み戻しも`Asia/Tokyo`へ変換し、実行環境のタイムゾーンや固定のUTCオフセットに依存しない。

保存単位と判定時計の精度は分ける。現在日時はDB時計の精度を保持してドメインとINSERTの判定に使い、利用開始予定日時と等しければ許可し、過ぎていれば拒否する。機材の最終変更日時も予約の予定日時とは区別し、`Instant`のナノ秒精度を失わず保存・復元する。

API契約、SQL式、実装上の注意、実DBでの受入条件は[Issue #15](https://github.com/otaki0413/ts-ddd/issues/15)に記載する。
