# ROSEMARY

ROSEMARY は、小説・脚本などの創作におけるストーリープロットを、プレーンテキストで構造化して記述するための記法です。シーン、キャラクター、アイテム、伏線、セリフ、関係性、時間変化を `.rsmr` ファイルとして管理し、VSCode 拡張機能でハイライトやプレビューを行えます。

## ファイル拡張子

ROSEMARY ファイルの拡張子は `.rsmr` です。

```txt
plot.rsmr
character.rsmr
item.rsmr
```

## 基本構文

ROSEMARY の基本単位は `block` です。

```rsmr
"block_name"{
    "text"
}
```

1 行で書くこともできます。

```rsmr
"block_name"{"text"}
```

`block_name` は block の名前、`text` は block の本文です。シーン名、キャラクター名、アイテム名、情報名などを block 名として使います。

## メタ情報

ファイル全体に関わる情報は、ファイル先頭に `---` で囲んで記述します。

```rsmr
---
title: "雨の記憶"
genre: "ミステリ"
theme: "信頼と嘘"
version: 0.1
graph: true
---
```

メタ情報には、タイトル、ジャンル、テーマ、バージョンなどを記述できます。
`graph` はプレビュー上の Graph 表示を制御します。未記述、または `graph: true` の場合は Graph を表示し、`graph: false` の場合は Graph を非表示にします。

## include

別の `.rsmr` ファイルを読み込むには、トップレベルに `@include` を記述します。

```rsmr
@include "character.rsmr"
@include "item.rsmr"

"雨の日の再会"[scene]{
    @ "佐倉ミオ"
    @ "古い鍵" --"発見"-->
}
```

include の仕様は以下です。

- `@include` はトップレベル専用です。
- パスは、`@include` を書いたファイルからの相対パスです。
- 最初に対応する対象は単一ファイルです。
- include は再帰的に解決されます。
- 循環 include は error として診断されます。
- include 先の block も link 解決、Graph、Blocks 表示の対象になります。

例:

```rsmr
// character.rsmr
"佐倉ミオ"[character]{
    age: 17
    personality: "慎重"
}
```

## attribute

`attribute` は block の性質や種別を示す情報です。block 名の後ろに `[]` で記述します。

```rsmr
"雨の日の再会"[scene]{
    "ミオと蓮が再会する"
}
```

複数の attribute を書くこともできます。

```rsmr
"雨の日の再会"[scene, chapter=1, pov="ミオ", place="駅", status="draft"]{
    "ミオと蓮が再会する"
}
```

attribute には、単独の属性と key-value 属性があります。

```rsmr
[scene]
[chapter=1]
[pov="ミオ"]
```

代表的な block 種別は以下です。

- `scene`: シーン
- `character`: キャラクター
- `dialogue`: セリフ
- `info`: 情報
- `item`: アイテム
- `act`: 幕
- `chapter`: 章
- `state`: 特定時点・期間の状態
- `relationship`: キャラクター間の関係
- `unknown`: 未定義・未決定の情報

## tag

`tag` は検索や分類のための補助的な印です。`#` から始まる文字列として記述します。

```rsmr
"古い鍵"[item][#伏線 #未回収 #父親]{
    "父の遺品。第三章で意味が判明する"
}
```

attribute と tag は分けて書けます。

```rsmr
"佐倉ミオ"[character][#主人公 #探偵役]{
    age: 17
}
```

## field

`field` は block 内に記述する任意の項目です。`name: value` の形式で書きます。

```rsmr
"佐倉ミオ"[character]{
    age: 17
    personality: "慎重"
    goal: "父の失踪の真相を知る"
    active: true
}
```

値には、文字列、数値、真偽値、識別子を使えます。

```rsmr
name: "佐倉ミオ"
age: 17
active: true
status: draft
```

長文、通常リスト、数字リスト、セリフ、注釈は、`field: [` から単独行の `]` までに記述します。

```rsmr
"雨の日の再会"[scene]{
    summary: [
        ミオと蓮が十年ぶりに駅で再会する。
        雨の音で会話が途切れ、互いに言えないことを抱えている。
        古い鍵はこの時点では意味を明かさない。
    ]
}
```

`field: [` 内では、通常の文章、`- ` で始まる通常リスト、`1. ` のような数字で始まる数字リスト、`speaker >line` のセリフ、`^` で始まる注釈を混在できます。通常リストと数字リストはインデントで多重リストにできます。通常リスト、数字リスト、セリフの末尾には `^ 注釈` を付けられます。

```rsmr
"雨の日の再会"[scene]{
    summary: [
        長文・リストの記述を同時に許可する。
        - "ミオが駅に到着する" ^ 動作は短く
            - "傘を閉じる"
            - "ホームを見渡す"
        - "蓮がミオに気づく"
        1. "再会"
            1. "沈黙"
            2. "確認"
        2. "沈黙" ^ 余白を作る
        ミオ >また会うとは思わなかった ^ 小さな声
        蓮 >俺もだ
        ^ 初稿では再会の余韻を長めに取る
        長文用の文字列として認識する。
    ]
}
```

文章として `- `、`1. `、`^` から始めたい場合は、先頭をエスケープします。

```rsmr
note: [
    \- これはリストではなく文章
    \1. これも数字リストではなく文章
    \^ これは注釈ではなく文章
]
```

## link

`link` は block 同士の関係を示します。block 内に `@ "block_name"` と書きます。

```rsmr
"雨の日の再会"[scene]{
    @ "古い鍵"
}

"古い鍵"[item]{
    "父の遺品"
}
```

link には attribute を付けられます。

```rsmr
"佐倉ミオ"[character]{
    @ "高瀬蓮"[relation, type="幼なじみ", trust=6]
}
```

## line

`line` は link の矢印の種類やラベルを指定します。

```rsmr
"block_A"{
    @ "block_B" --"伏線"-->
}
```

使用できる line は以下です。

| 種類 | ラベルなし | ラベルあり |
| --- | --- | --- |
| 実線 | `-->` | `--"伏線"-->` |
| 点線 | `-.->` | `-."伏線"-.->` |
| 太線 | `==>` | `=="核心"==>` |
| 双方向実線 | `<-->` | `<--"共闘"-->` |

双方向矢印は、記述元と指定先が同様の関係を持つ場合に使います。

```rsmr
"佐倉ミオ"[character]{
    @ "高瀬蓮"[relation, type="協力者", trust=7] <--"共闘"-->
}
```

両者の認識や感情が異なる場合は、片方向 link をそれぞれ記述します。

```rsmr
"佐倉ミオ"[character]{
    @ "高瀬蓮"[relation, emotion="不信", trust=2] --"警戒"-->
}

"高瀬蓮"[character]{
    @ "佐倉ミオ"[relation, emotion="庇護", trust=8] --"守りたい"-->
}
```

## 伏線と回収

`?` は謎・問い・未解決の論点を示します。`!` は答え・回収・判明した事実を示します。本文は引用符なしで記述できます。引用符付きの記述も引き続き使えます。

```rsmr
"古い鍵"{
    ? なぜ父はこれを残したのか
    ! 地下室を開ける鍵だった
}
```

## 階層構造

block は他の block を内部に持てます。幕、章、シーン、ビートなどの親子関係を表現できます。

```rsmr
"第一幕"[act]{
    "主人公が事件に巻き込まれる"

    "第一章"[chapter]{
        "物語の導入"

        "雨の日の再会"[scene]{
            "ミオと蓮が再会する"
        }
    }
}
```

## セリフ・発話者

block 内では、発話者名とセリフを `speaker >line` の形式で記述できます。

```rsmr
"雨の日の再会"[scene]{
    ミオ >久しぶり
    蓮 >……本当に、ミオなのか
}
```

## 注釈

block 内または `field: [` 内では、`^note` または `^ note` の形式で注釈を記述できます。通常リスト、数字リスト、セリフの末尾には `^ 注釈` を付けられます。プレビュー上では斜字で表示されます。

```rsmr
"雨の日の再会"[scene]{
    ^ 雨音を強めに描写する

    summary: [
        ミオと蓮が十年ぶりに駅で再会する。
        - ミオが駅に到着する ^ 動作は短く
        1. 再会 ^ 余白を作る
        ミオ >久しぶり ^ 小さな声
        ^ 初稿用の補足
    ]
}
```

## キャラクター定義

キャラクターは `character` 属性を持つ block として定義します。

```rsmr
"佐倉ミオ"[character]{
    age: 17
    personality: "慎重"
    goal: "父の失踪の真相を知る"
    weakness: "他人を信用できない"
}
```

キャラクター名は block 名として扱われます。

## キャラクター情報の時間変化

時間によるキャラクター情報の変化は、キャラクター block 内に `state` block を書いて表現します。

```rsmr
"佐倉ミオ"[character]{
    age: 17
    personality: "慎重"
    goal: "父の失踪の真相を知る"

    "第一章時点"[state, at="第一章"]{
        personality: "他人を信用しない"
        goal: "父の手がかりを探す"
    }

    "第四章時点"[state, at="第四章"]{
        personality: "蓮だけは信用し始めている"
        goal: "父を追っていた組織の正体を暴く"
    }
}
```

期間を持つ状態は `from` / `to` で表現します。

```rsmr
"佐倉ミオ"[character]{
    "序盤の状態"[state, from="第一章", to="第二章"]{
        trust: "低い"
        personality: "警戒心が強い"
    }
}
```

## キャラクター間の関係

キャラクター間の関係は、`relation` 属性を持つ link として記述します。

```rsmr
"佐倉ミオ"[character]{
    @ "高瀬蓮"[relation, type="幼なじみ", trust=2, at="第一章"] --"不信"-->
    @ "高瀬蓮"[relation, type="協力者", trust=5, at="第三章"] --"共闘"-->
    @ "高瀬蓮"[relation, type="大切な人", trust=9, at="終章"] =="信頼"==>
}
```

関係そのものを詳しく管理したい場合は、`relationship` block を使います。

```rsmr
"ミオと蓮の関係"[relationship, from="佐倉ミオ", to="高瀬蓮"]{
    "第一章時点"[state, at="第一章"]{
        type: "幼なじみ"
        trust: 2
        emotion: "不信"
    }

    "第三章時点"[state, at="第三章"]{
        type: "協力者"
        trust: 5
        emotion: "共闘"
    }

    "終章時点"[state, at="終章"]{
        type: "大切な人"
        trust: 9
        emotion: "信頼"
    }
}
```

## 未定義・未決定の情報

まだ決まっていない情報は `unknown` 属性を持つ block として記述します。

```rsmr
"犯人の動機"[unknown]{
    "まだ未定"
}
```

## コメント

`//` から始まる行はコメントとして扱われます。

```rsmr
// このシーンは後で場所を変更する可能性がある
"雨の日の再会"[scene]{
    "駅で再会する"
    // ここで傘を共有させる
}
```

コメントは描画や関係性の解析には使われません。

## 完全な例

```rsmr
---
title: "雨の記憶"
genre: "ミステリ"
theme: "信頼と嘘"
version: 0.1
---

@include "character.rsmr"
@include "item.rsmr"

"第一幕"[act]{
    "主人公が事件に巻き込まれる"

    "雨の日の再会"[scene, chapter=1, pov="佐倉ミオ", place="駅"][#再会 #雨]{
        "ミオと蓮が十年ぶりに駅で再会する"

        summary: [
            ミオと蓮が十年ぶりに駅で再会する。
            - "ミオが駅に到着する"
            - "蓮がミオに気づく"
            - "古い鍵が落ちる"
            1. "再会"
            2. "沈黙"
            古い鍵はこの場面では意味を明かさず、読者に違和感だけを残す。
        ]

        ミオ >久しぶり
        蓮 >……本当に、ミオなのか

        @ "佐倉ミオ"
        @ "高瀬蓮"[relation, type="幼なじみ", trust=2] --"警戒"-->
        @ "古い鍵" --"発見"-->
    }
}
```

## VSCode 拡張機能

配布された VSIX は以下のようにインストールできます。

```bash
code --install-extension rosemary-vscode-0.1.0.vsix
```

VSCode 上では以下の機能を利用できます。

- `.rsmr` ファイル用アイコンの表示
- `.rsmr` ファイルのシンタックスハイライト
- `ROSEMARY: Open Preview` によるプレビュー
- 複数プレビューウィンドウの同時表示
- Graph 表示
- Blocks 表示
- Meta 表示
- `@include` を含むプロジェクト単位の解析
- セリフの引用風プレビュー表示
- 注釈の斜字プレビュー表示
- エディタとプレビューのスクロール同期
- include 先 block を除外したスクロール同期
- エディタとプレビュー間の block 折りたたみ同期
- include 先 block の初期折りたたみ表示
- Graph のズーム・パン
- block 名が本文・field 値・セリフなどに出現した箇所のハイライト
- ハイライトされた block 名のホバーによる定義内容のプレビュー
- ハイライトされた block 名上の右クリックメニューから定義へジャンプ
- field 内リストの Enter 補助入力
- Code Spell Checker 使用時の `rsmr` 辞書登録
- 診断情報の Problems / Debug Console 表示

## VSCode 拡張機能の設定

block 名の出現ハイライトは、VSCode の設定から調整できます。

```json
{
  "rosemary.listEditing.enabled": true,
  "rosemary.blockReferenceHighlight.enabled": true,
  "rosemary.blockReferenceHighlight.excludedBlockNames": [
    "雨",
    "鍵"
  ],
  "rosemary.blockReferenceHighlight.colors": {
    "default": "rgba(189, 147, 249, 0.22)",
    "character": "rgba(80, 200, 120, 0.24)",
    "scene": "rgba(74, 144, 226, 0.24)",
    "item": "rgba(240, 190, 90, 0.24)",
    "relationship": "rgba(180, 120, 255, 0.24)"
  }
}
```

`listEditing.enabled` を `false` にすると、`field: [` 内での Enter と Tab によるリスト入力補助を無効化できます。

`excludedBlockNames` に指定した block 名は、本文中に出現してもハイライトされません。右クリックメニューの定義ジャンプ候補にも表示されません。`colors` は block 種別ごとに指定でき、未指定の種別には `default` が使われます。

本文中のハイライトされた block 名の上で右クリックし、`ROSEMARY: Jump to Block Definition...` を選ぶと、その block 定義へ移動できます。カーソル位置に複数の block 名が重なる場合は、`あいうの定義へジャンプ`、`あいうえおの定義へジャンプ` のように候補が複数表示されます。

本文中のハイライトされた block 名にカーソルをホバーすると、その block の属性、タグ、field、本文、セリフ、link、疑問・解答を要約したパネルが表示されます。カーソル位置に複数の block 名が重なる場合は、複数の block 定義が区切られて表示されます。

`field: [` 内で `- 項目` または `1. 項目` の行末で Enter を押すと、次の `- ` または `n. ` が自動挿入されます。自動挿入された marker 行で Tab を押すと一段深いリストとしてインデントされます。空の marker 行でもう一度 Enter を押すと、marker が削除されてリスト入力を終了できます。
