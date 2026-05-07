# DEVELOPMENT

このドキュメントは、ROSEMARY 記法および VSCode 拡張機能を開発するための手順書である。開発は、まず記法を解析する中核ライブラリを作成し、その後 VSCode 拡張機能へ接続する順序で進める。

## 開発方針

- `PROJECT.md` を仕様の一次情報として扱う。
- 仕様変更が発生した場合は、実装より先に `PROJECT.md` を更新する。
- VSCode 拡張機能に直接ロジックを書かず、記法の解析・検証・グラフ変換は中核ライブラリに集約する。
- 最初から全機能の UI を作らず、構文解析、診断、描画用データ生成の順で土台を固める。
- 代表的な `.rsmr` サンプルとテストを常に仕様確認に使える状態にする。

## 開発対象

最終的に以下を開発する。

- `.rsmr` 記法の tokenizer
- `.rsmr` 記法の parser
- AST 型定義
- 構文・意味診断
- block / link を描画用の graph model に変換する処理
- VSCode 拡張機能
- シンタックスハイライト
- アウトライン表示
- 補完
- 定義ジャンプ
- グラフプレビュー

## 推奨ディレクトリ構成

実装開始時点では、以下のような構成を目標にする。

```txt
.
├── PROJECT.md
├── DEVELOPMENT.md
├── examples/
│   └── full-syntax.rsmr
├── packages/
│   └── rosemary-core/
│       ├── src/
│       │   ├── ast.ts
│       │   ├── diagnostics.ts
│       │   ├── graph.ts
│       │   ├── index.ts
│       │   ├── parser.ts
│       │   └── tokenizer.ts
│       └── tests/
│           ├── parser.test.ts
│           ├── diagnostics.test.ts
│           └── graph.test.ts
└── extensions/
    └── vscode-rosemary/
        ├── package.json
        ├── syntaxes/
        │   └── rosemary.tmLanguage.json
        └── src/
            └── extension.ts
```

必要に応じて構成は変更してよい。ただし、`rosemary-core` と VSCode 拡張機能の責務は分離する。

## 実装フェーズ

### Phase 1: 仕様サンプルの作成

`PROJECT.md` に定義されている全構文を含むサンプルファイルを作成する。

作成するファイル:

- `examples/full-syntax.rsmr`

含める構文:

- メタ情報
- block
- attribute
- key-value attribute
- tag
- field
- link
- line
- 双方向 line
- 伏線と回収
- 階層構造
- セリフ・発話者
- character
- state
- relation
- relationship
- unknown
- コメント

完了条件:

- `PROJECT.md` のすべての記法要素がサンプル内に最低 1 回登場している。
- サンプルを見れば、ROSEMARY の基本的な書き方が把握できる。

### Phase 2: 開発環境の作成

TypeScript を前提に、記法解析用の中核パッケージを作成する。

作成するもの:

- package manager 設定
- TypeScript 設定
- test runner 設定
- formatter / linter 設定
- `rosemary-core` パッケージ

完了条件:

- テストコマンドが実行できる。
- TypeScript の型チェックが実行できる。
- `rosemary-core` から公開 API を export できる。

### Phase 3: AST 型定義

ROSEMARY 文書を表現する AST を定義する。

主要な型:

- `RosemaryDocument`
- `MetaBlock`
- `BlockNode`
- `Attribute`
- `Tag`
- `Field`
- `Link`
- `Line`
- `Question`
- `Answer`
- `Dialogue`
- `Diagnostic`

設計方針:

- 各 node には元テキスト上の位置情報を持たせる。
- VSCode の診断・ジャンプ・ハイライトで使えるよう、開始位置と終了位置を保持する。
- 階層構造を扱えるよう、`BlockNode` は子 block を持てる構造にする。
- link は記述元 block と参照先 block 名を保持する。
- 双方向 link は line の種類として扱う。

完了条件:

- `PROJECT.md` の構文要素を AST で表現できる。
- 位置情報を保持する設計になっている。

### Phase 4: Tokenizer の実装

`.rsmr` の文字列を token 列に変換する。

扱う token:

- string
- identifier
- number
- boolean
- `{`
- `}`
- `[`
- `]`
- `(`
- `)`
- `,`
- `:`
- `=`
- `@`
- `#tag`
- `?`
- `!`
- `// comment`
- `---`
- `-->`
- `--"label"-->`
- `-.->`
- `-."label"-.->`
- `==>`
- `=="label"==>`
- `<-->`
- `<--"label"-->`

完了条件:

- コメントを token として保持するか、解析から除外できる。
- 文字列中の記号を構文記号として誤認しない。
- token に位置情報が付与されている。

### Phase 5: Parser の実装

token 列を AST に変換する。

実装する構文:

- メタ情報
- block
- attribute
- key-value attribute
- tag
- field
- link
- line
- question
- answer
- dialogue
- nested block

完了条件:

- `examples/full-syntax.rsmr` を AST に変換できる。
- 構文エラーがあっても、可能な範囲で解析を継続できる。
- VSCode 上で使えるよう、エラー位置を診断として返せる。

### Phase 6: Diagnostics の実装

AST を検証し、エラーや警告を生成する。

検出する項目:

- 閉じられていない block
- 壊れた attribute
- 壊れた tag
- 壊れた link
- 未定義 block への link
- 重複 block 名
- `character` 以外に不自然に置かれた `relation`
- `state` に `at` / `from` / `to` がない場合の警告
- 双方向 link に非対称な意味を持つ属性がある場合の注意

完了条件:

- parser と diagnostics が分離されている。
- エラーと警告の severity を区別できる。
- 診断には message、位置、関連 node 情報が含まれる。

### Phase 7: Graph Model の実装

AST から描画用の node / edge 構造を生成する。

出力する情報:

- block node
- block の種別
- attribute
- tag
- 表示テキスト
- link edge
- line 種別
- line label
- direction
- relation 情報

完了条件:

- block を graph node に変換できる。
- link を graph edge に変換できる。
- `<-->` を双方向 edge として扱える。
- attribute や tag によるフィルタリングの下地がある。

### Phase 8: VSCode 拡張機能の最小実装

`.rsmr` ファイルを VSCode 上で扱えるようにする。

最初に実装する機能:

- 拡張子 `.rsmr` の language registration
- TextMate grammar によるシンタックスハイライト
- parser を用いた diagnostics 表示
- document outline

完了条件:

- `.rsmr` ファイルを開くと ROSEMARY 言語として認識される。
- 構文エラーがエディタ上に表示される。
- block が outline に表示される。

### Phase 9: VSCode 拡張機能の編集支援

作家が記述しやすくなる機能を追加する。

候補:

- block 名の補完
- attribute の補完
- tag の補完
- link 先 block 名の補完
- 定義ジャンプ
- 参照検索
- block 名変更
- 未定義 block の quick fix

完了条件:

- `@ "..."` の入力時に block 名補完が出る。
- link 先へジャンプできる。
- block 名変更時に参照も更新できる。

### Phase 10: グラフプレビュー

ROSEMARY 文書を関係図として表示する。

最初に実装する表示:

- block node
- link edge
- line label
- 実線・点線・太線
- 双方向矢印
- character / scene などの種別ごとの表示差

完了条件:

- 現在開いている `.rsmr` ファイルをプレビューできる。
- ファイル変更に追従してプレビューが更新される。
- graph model の出力をそのまま利用している。

## 実装順序の優先度

優先度は以下の通りとする。

1. `examples/full-syntax.rsmr`
2. `rosemary-core` の AST 型定義
3. tokenizer
4. parser
5. parser tests
6. diagnostics
7. graph model
8. VSCode language registration
9. syntax highlight
10. diagnostics integration
11. outline
12. completion / definition
13. graph preview

## テスト方針

テストは仕様の固定と回帰防止を目的とする。

最低限用意するテスト:

- 最小 block を parse できる
- attribute を parse できる
- key-value attribute を parse できる
- tag を parse できる
- field を parse できる
- link を parse できる
- line label を parse できる
- 双方向 line を parse できる
- question / answer を parse できる
- nested block を parse できる
- dialogue を parse できる
- character state を parse できる
- relationship block を parse できる
- comment を無視または保持できる
- 未定義 link を診断できる
- 重複 block 名を診断できる

## 開発時の作業ルール

開発作業は以下の順で進める。

1. `PROJECT.md` とこの `DEVELOPMENT.md` を確認する。
2. 変更対象の責務を確認する。
3. 必要最小限のファイルを編集する。
4. 実装に対応するテストを追加する。
5. 型チェックとテストを実行する。
6. 仕様にズレが生じた場合は `PROJECT.md` を更新する。
7. 実装内容、検証結果、残課題を報告する。

## 判断基準

実装中に迷った場合は、以下の順で判断する。

1. 作家がプレーンテキストとして読み書きしやすいか。
2. `PROJECT.md` の仕様と整合しているか。
3. VSCode 拡張機能から扱いやすい AST になるか。
4. 将来の描画や補完に必要な位置情報が残るか。
5. 記法が過度に複雑になっていないか。

## 最初の開発タスク

最初に着手するタスクは以下とする。

1. `examples/full-syntax.rsmr` を作成する。
2. TypeScript プロジェクトを初期化する。
3. `packages/rosemary-core/src/ast.ts` を作成する。
4. AST 型を定義する。
5. 最小 block の parser test を追加する。

