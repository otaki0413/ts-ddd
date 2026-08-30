# バックエンドを4層とComposition Rootに分けて配置する

単一コンテキスト・単一パッケージのTypeScriptバックエンドを、責務に対応する4層と、層外のComposition Rootで構成する。DDDの学習で業務の判断と入出力の境界を追いやすくするため、機能の変更が複数の層にまたがることを受け入れ、層別の配置を選ぶ。採用するライブラリや実行環境の選定は[ADR-0010](./0010-technology-stack.md)に分ける。

## 各層の責務と依存方向

| 配置                  | 責務                                                                   | 他の層への参照          |
| --------------------- | ---------------------------------------------------------------------- | ----------------------- |
| `src/presentation/`   | HTTP入力の構造・型の検証、アプリケーションの呼び出し、HTTP応答への変換 | `application`、`domain` |
| `src/application/`    | ユースケースの手順の調整、必要な入出力のポートの定義                   | `domain`                |
| `src/domain/`         | 集約・値オブジェクト・業務上の判定                                     | 他の3層へ依存しない     |
| `src/infrastructure/` | ポートの具象実装、永続化マッピング、DB操作とトランザクションの実行     | `application`、`domain` |

層名は技術名ではなく責務を表す。HTTP入出力を`presentation`へ置き、予約期間の妥当性や予約可否などの業務ルールは`domain`に置く。`domain`と`application`はHTTP・永続化の技術や環境設定から独立させる。

依存方向はソースコード上の参照で捉える。Repository・Query・Committer・時計・ID生成などのポートは、入出力を必要とする`application`に定義する。`infrastructure`がその契約を実装し、`application`は注入されたポートを呼び出すことで、具象アダプタを参照せずに処理を進める。

`presentation`はユースケースまたは`application`が定義するポートを呼び出す。識別子の受け渡しや応答への変換に`domain`の型を使うが、SQLや具象アダプタの生成は置かない。現在の予約作成はユースケースを通し、IDによる読み戻しはRepositoryポートを呼び出している。

`infrastructure`は原子的な処理の中で`domain`のポリシーを呼び出すことがある。業務上の判定を定義する責務は`domain`、その判定と保存を原子的に実行する責務は`infrastructure`に置く。予約確定の具体的な方式と保証条件は[ADR-0011](./0011-atomic-reservation-commit-with-postgresql.md)に従う。

## 層外での組み立てと起動

`src/composition-root.ts`は、ユースケース、PostgreSQLアダプタ、時計、ID生成を組み立てるComposition Rootとして`src`直下に置く。複数の層の具象実装を知る必要があるため、アプリケーションサービス本体や永続化処理とは分け、4層の外で接続関係を決める。`application`、`domain`、`infrastructure`を参照するが、業務ルールは定義しない。

現在のComposition Rootは、外側から受け取ったDrizzleのDBを使ってサービスを組み立てる。接続プールの生成と終了、環境設定の読み取り、組み立てたサービスのHTTPアプリへの注入は`vite.config.ts`が担当する。`src/main.ts`はHTTPアプリを公開する薄い起動入口として`src`直下に置く。

`presentation`からComposition Rootへの`ReservationServices`の参照は型のみとする。組み立て処理やPostgreSQLアダプタをHTTP処理から生成・実行するための依存にはしない。

## この判断の範囲

このADRは現在のバックエンドの層構成と組み立ての境界を定める。層内部のサブディレクトリ構成や将来の拡張構成は規定しない。配置は担当する責務と必要な依存関係から判断し、将来の用途だけを想定した空の層やディレクトリは追加しない。
