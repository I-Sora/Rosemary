# ROSEMARY

ROSEMARY は、`.rsmr` ファイルでストーリープロットを書くための VS Code 拡張機能です。

ROSEMARY 記法は、小説や脚本などの創作計画のために設計されています。シーン、キャラクター、アイテム、伏線、回収、セリフ、関係性、時間変化、未決定のアイデアを、構造化されたプレーンテキストとして記述し、VS Code 内で視覚的にプレビューできます。

## 機能

- `.rsmr` ファイルのシンタックスハイライト
- Meta、Graph、Blocks ビューを備えたプレビューパネル
- Graph のパンとズーム
- エディタとプレビューの block 折りたたみ
- エディタとプレビュー間のスクロール・カーソル同期
- block 参照のハイライト、ホバー要約、定義ジャンプ
- `@include "file.rsmr"` によるプロジェクト分割
- character、item、scene、relationship、state、unknown block のサポート
- 長文、ネストされたリスト、数字付きリスト、セリフ、注釈を含む rich field value
- `field: [` block 編集時の Enter と Tab によるリスト入力補助

## クイックスタート

`.rsmr` 拡張子のファイルを作成します。

```rsmr
---
title: "雨の記憶"
genre: "ミステリ"
graph: true
---

"雨の日の再会"[scene, pov="ミオ"][#雨]{
    summary: [
        ミオと蓮が十年ぶりに再会する。
        - ミオが駅に到着する ^ この動作は短く
            - 傘を閉じる
            - ホームを見渡す
        1. 再会
        2. 沈黙
        ミオ >また会うとは思わなかった ^ 小さな声
    ]

    @ "古い鍵" --"発見"-->
}

"古い鍵"[item][#伏線]{
    ? なぜミオの父はこの鍵を残したのか
    ! 隠された地下室を開ける鍵だった
}
```

コマンドパレットを開き、次を実行します。

```txt
ROSEMARY: Open Preview
```

## 基本文法

### Blocks

```rsmr
"Block Name"[scene][#tag]{
    "Body text"
}
```

block 名は引用文字列です。`[scene]`、`[character]`、`[item]`、`[relationship]`、`[state]`、`[unknown]` などの attribute で block の種別を表します。tag は `#` から始まります。

### Fields

```rsmr
"佐倉ミオ"[character]{
    age: 17
    personality: "慎重"
    goal: "父の真相を知る"
}
```

field は `name: value` の形式で記述します。値には文字列、数値、真偽値、識別子、または multiline field block を指定できます。

### Multiline Field Blocks

```rsmr
summary: [
    長文をここに記述できます。
    - 通常リスト項目
        - ネストされた項目
    1. 数字付きリスト項目
    2. 数字付きリスト項目 ^ この項目への注釈
    ミオ >ここにセリフを書ける ^ セリフへの注釈
    ^ 独立した注釈
]
```

`field: [` block 内では、段落、ネストされたリスト、数字付きリスト、セリフ、注釈を使用できます。

### Links and Lines

```rsmr
"Scene A"[scene]{
    @ "Scene B" --> 
    @ "古い鍵" --"伏線"-->
    @ "ミオと蓮" <-->
}
```

link はプレビュー graph 上で block 同士を接続します。使用できる line 形式には `-->`、`-.->`、`==>`、`<-->` があります。

### Include

```rsmr
@include "character.rsmr"
@include "item.rsmr"
```

include された `.rsmr` ファイルは、include directive を含むファイルからの相対パスとして解決されます。include 先の block は、link 解決、graph 表示、ホバー要約、プレビュー表示の対象になります。

## 拡張機能の設定

```json
{
  "rosemary.blockReferenceHighlight.enabled": true,
  "rosemary.blockReferenceHighlight.excludedBlockNames": [],
  "rosemary.blockReferenceHighlight.colors": {
    "default": "rgba(189, 147, 249, 0.22)",
    "scene": "rgba(74, 144, 226, 0.24)",
    "character": "rgba(80, 200, 120, 0.24)",
    "item": "rgba(240, 190, 90, 0.24)"
  }
}
```

短すぎる block 名や曖昧な block 名をハイライト対象から外したい場合は、`excludedBlockNames` を使用します。

## プライバシーとセキュリティ

ROSEMARY はプロジェクト内容を外部サービスへ送信せず、外部プロセスも実行しません。

この拡張機能は、`@include` directive を解決するために現在のプロジェクト内の `.rsmr` ファイルを読み込みます。プレビュー内容は VS Code webview 内でローカルに描画されます。

## 既知の制限

- 言語仕様はまだ発展中であり、安定版 1.0 の公開までに構文が変わる可能性があります。
- graph layout は軽量な preview を目的としており、完全な図表編集ツールではありません。
- include path は現在ファイルパスとして扱われ、`.rsmr` ファイルを指す必要があります。

## サポート

サポートと issue 報告の案内は `SUPPORT.md` を参照してください。

---

# ROSEMARY

## English

ROSEMARY is a VS Code extension for writing story plots in `.rsmr` files.

ROSEMARY markup is designed for fiction planning: scenes, characters, items, foreshadowing, answers, dialogue, relationships, timelines, and unresolved ideas can be written as structured plain text and previewed visually inside VS Code.

## Features

- Syntax highlighting for `.rsmr` files
- Preview panel with Meta, Graph, and Blocks views
- Graph pan and zoom
- Block folding in the editor and preview
- Scroll and cursor synchronization between editor and preview
- Block reference highlighting, hover summaries, and jump-to-definition
- Project includes with `@include "file.rsmr"`
- Character, item, scene, relationship, state, and unknown block support
- Rich field values with multiline text, nested lists, numbered lists, dialogue, and annotations
- List continuation helpers for Enter and Tab while editing `field: [` blocks

## Quick Start

Create a file with the `.rsmr` extension:

```rsmr
---
title: "Rain Memory"
genre: "Mystery"
graph: true
---

"Rainy Reunion"[scene, pov="Mio"][#rain]{
    summary: [
        Mio and Ren meet again after ten years.
        - Mio arrives at the station ^ Keep this action short
            - She closes her umbrella
            - She looks around the platform
        1. Reunion
        2. Silence
        Mio >I never thought I would see you again ^ quietly
    ]

    @ "Old Key" --"discovery"-->
}

"Old Key"[item][#foreshadowing]{
    ? Why did Mio's father leave this key?
    ! It opens the hidden basement.
}
```

Open the command palette and run:

```txt
ROSEMARY: Open Preview
```

## Basic Syntax

### Blocks

```rsmr
"Block Name"[scene][#tag]{
    "Body text"
}
```

Block names are quoted strings. Attributes such as `[scene]`, `[character]`, `[item]`, `[relationship]`, `[state]`, and `[unknown]` describe the block type. Tags start with `#`.

### Fields

```rsmr
"Sakura Mio"[character]{
    age: 17
    personality: "careful"
    goal: "Find the truth about her father"
}
```

Fields use `name: value`. Values can be strings, numbers, booleans, identifiers, or multiline field blocks.

### Multiline Field Blocks

```rsmr
summary: [
    Long text can be written here.
    - Unordered list item
        - Nested item
    1. Ordered list item
    2. Ordered list item ^ Annotation for this item
    Mio >Dialogue can be written here ^ Dialogue annotation
    ^ Standalone annotation
]
```

Inside `field: [` blocks, ROSEMARY supports paragraphs, nested lists, numbered lists, dialogue, and annotations.

### Links and Lines

```rsmr
"Scene A"[scene]{
    @ "Scene B" --> 
    @ "Old Key" --"foreshadowing"-->
    @ "Mio and Ren" <-->
}
```

Links connect blocks in the preview graph. Supported line forms include `-->`, `-.->`, `==>`, and `<-->`.

### Include

```rsmr
@include "character.rsmr"
@include "item.rsmr"
```

Included `.rsmr` files are resolved relative to the file that contains the include directive. Included blocks participate in link resolution, graph rendering, hover summaries, and preview display.

## Extension Settings

```json
{
  "rosemary.blockReferenceHighlight.enabled": true,
  "rosemary.blockReferenceHighlight.excludedBlockNames": [],
  "rosemary.blockReferenceHighlight.colors": {
    "default": "rgba(189, 147, 249, 0.22)",
    "scene": "rgba(74, 144, 226, 0.24)",
    "character": "rgba(80, 200, 120, 0.24)",
    "item": "rgba(240, 190, 90, 0.24)"
  }
}
```

Use `excludedBlockNames` to avoid highlighting short or ambiguous block names.

## Privacy and Security

ROSEMARY does not send project content to external services and does not run external processes.

The extension reads `.rsmr` files in the current project when resolving `@include` directives. Preview content is rendered locally in a VS Code webview.

## Known Limitations

- The language is still evolving, and syntax may change before a stable 1.0 release.
- The graph layout is intended as a lightweight preview, not a full diagram editor.
- Include paths are currently file based and should point to `.rsmr` files.

## Support

See `SUPPORT.md` for support and issue reporting guidance.
