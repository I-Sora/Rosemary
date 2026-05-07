import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildGraph,
  parseRosemaryProject,
  parseRosemary,
  tokenize,
  validateDocument,
  type BlockNode,
} from "../src/index.js";

describe("tokenize", () => {
  it("tokenizes bidirectional labeled lines", () => {
    const tokens = tokenize('@ "高瀬蓮" <--"共闘"-->');
    const line = tokens.find((token) => token.kind === "line");

    expect(line?.value).toMatchObject({
      style: "solid",
      direction: "bidirectional",
      label: "共闘",
    });
  });
});

describe("parseRosemary", () => {
  it("parses a minimal block", () => {
    const { document, diagnostics } = parseRosemary('"block_name"{"text"}');

    expect(diagnostics).toEqual([]);
    expect(document.blocks).toHaveLength(1);
    expect(document.blocks[0]).toMatchObject({
      kind: "block",
      name: "block_name",
    });
    expect(document.blocks[0]?.entries[0]).toMatchObject({
      kind: "text",
      value: "text",
    });
  });

  it("parses include paths with .rsmr extensions", () => {
    const { document, diagnostics } = parseRosemary(`
@include "character.rsmr"

"plot"{
}
`);
    const tokens = tokenize('@include "character.rsmr"');

    expect(diagnostics).toEqual([]);
    expect(document.includes[0]?.path).toBe("character.rsmr");
    expect(tokens.some((token) => token.kind === "unknown")).toBe(false);
  });

  it("parses attributes, tags, fields, and nested states", () => {
    const { document, diagnostics } = parseRosemary(`
"佐倉ミオ"[character][#主人公]{
    age: 17
    personality: "慎重"

    "第一章時点"[state, at="第一章"]{
        goal: "父の手がかりを探す"
    }
}
`);

    expect(diagnostics).toEqual([]);
    const character = document.blocks[0]!;
    expect(character.attributes.map((attribute) => attribute.name)).toContain(
      "character",
    );
    expect(character.tags.map((tag) => tag.name)).toContain("主人公");
    expect(character.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "field", name: "age" }),
        expect.objectContaining({ kind: "field", name: "personality" }),
      ]),
    );

    const state = character.entries.find(
      (entry): entry is BlockNode => entry.kind === "block",
    );
    expect(state).toMatchObject({
      name: "第一章時点",
      attributes: expect.arrayContaining([
        expect.objectContaining({ name: "state" }),
        expect.objectContaining({ name: "at" }),
      ]),
    });
  });

  it("parses unquoted dialogue text", () => {
    const { document, diagnostics } = parseRosemary(`
"雨の日の再会"[scene]{
    ミオ >久しぶり だね
    蓮 >本当にミオなのか ^ 小さく震える声
    memo: "久しぶり だね"
}
`);

    expect(diagnostics).toEqual([]);
    expect(document.blocks[0]?.entries[0]).toMatchObject({
      kind: "dialogue",
      speaker: "ミオ",
      text: "久しぶり だね",
    });
    expect(document.blocks[0]?.entries[1]).toMatchObject({
      kind: "dialogue",
      speaker: "蓮",
      text: "本当にミオなのか",
      annotation: "小さく震える声",
    });
    expect(document.blocks[0]?.entries[2]).toMatchObject({
      kind: "field",
      name: "memo",
    });
  });

  it("parses unquoted question and answer text", () => {
    const { document, diagnostics } = parseRosemary(`
"古い鍵"[item]{
    ? なぜ父はこれを残したのか?
    ! 地下室を開ける鍵だった // comment
    ? "引用符付きも継続して使える"
}
`);

    expect(diagnostics).toEqual([]);
    expect(document.blocks[0]?.entries[0]).toMatchObject({
      kind: "question",
      value: "なぜ父はこれを残したのか?",
    });
    expect(document.blocks[0]?.entries[1]).toMatchObject({
      kind: "answer",
      value: "地下室を開ける鍵だった",
    });
    expect(document.blocks[0]?.entries[2]).toMatchObject({
      kind: "question",
      value: "引用符付きも継続して使える",
    });
  });

  it("parses annotation entries", () => {
    const { document, diagnostics } = parseRosemary(`
"雨の日の再会"[scene]{
    ^ この場面は静かに始める
    ^ "引用符付き注釈も使える"
}
`);

    expect(diagnostics).toEqual([]);
    expect(document.blocks[0]?.entries[0]).toMatchObject({
      kind: "annotation",
      value: "この場面は静かに始める",
    });
    expect(document.blocks[0]?.entries[1]).toMatchObject({
      kind: "annotation",
      value: "引用符付き注釈も使える",
    });
  });

  it("parses the full syntax example", async () => {
    const source = await readFile(
      new URL("../../../examples/full-syntax.rsmr", import.meta.url),
      "utf8",
    );
    const { document, diagnostics } = parseRosemary(source);
    const semanticDiagnostics = validateDocument(document);

    expect(diagnostics).toEqual([]);
    expect(semanticDiagnostics).toEqual([]);
    expect(document.meta?.fields.map((field) => field.name)).toEqual([
      "title",
      "genre",
      "theme",
      "version",
      "graph",
    ]);

    const blocks = [...walkBlocks(document.blocks)];
    expect(blocks.map((block) => block.name)).toEqual(
      expect.arrayContaining([
        "第一幕",
        "雨の日の再会",
        "佐倉ミオ",
        "古い鍵",
        "ミオと蓮の関係",
        "犯人の動機",
      ]),
    );

    const scene = blocks.find((block) => block.name === "雨の日の再会")!;
    expect(scene.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "dialogue",
          speaker: "ミオ",
          text: "久しぶり",
        }),
        expect.objectContaining({ kind: "link", target: "古い鍵" }),
      ]),
    );

    const key = blocks.find((block) => block.name === "古い鍵")!;
    expect(key.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "question" }),
        expect.objectContaining({ kind: "answer" }),
      ]),
    );
  });

  it("parses bidirectional character relation links", () => {
    const { document, diagnostics } = parseRosemary(`
"佐倉ミオ"[character]{
    @ "高瀬蓮"[relation, type="協力者", trust=7, at="第四章"] <--"共闘"-->
}
"高瀬蓮"[character]{}
`);

    expect(diagnostics).toEqual([]);
    const link = document.blocks[0]?.entries.find(
      (entry) => entry.kind === "link",
    );
    expect(link).toMatchObject({
      kind: "link",
      target: "高瀬蓮",
      line: {
        style: "solid",
        direction: "bidirectional",
        label: "共闘",
      },
    });
  });

  it("parses include directives", () => {
    const { document, diagnostics } = parseRosemary(`
@include "character.rsmr"

"雨の日の再会"[scene]{}
`);

    expect(diagnostics).toEqual([]);
    expect(document.includes).toEqual([
      expect.objectContaining({
        kind: "include",
        path: "character.rsmr",
      }),
    ]);
  });

  it("parses bracket field values as multiline text and lists", () => {
    const { document, diagnostics } = parseRosemary(`
"雨の日の再会"[scene]{
    summary: [
        ミオと蓮が十年ぶりに駅で再会する。
        古い鍵はこの時点では意味を明かさない。
    ]

    beats: [
        - "ミオが駅に到着する"
        - "蓮がミオに気づく"
        - 古い鍵が落ちる
    ]

    order: [
        1. "再会"
        2. "沈黙"
        3. 鍵の発見
    ]

    outline: [
        - 第一幕
            - 発端
            - 葛藤
        - 第二幕
            1. 調査
            2. 発見 ^ 注釈
    ]
}
`);

    expect(diagnostics).toEqual([]);
    const scene = document.blocks[0]!;
    const fields = scene.entries.filter((entry) => entry.kind === "field");

    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "summary",
          value: expect.objectContaining({
            kind: "multilineText",
            value:
              "ミオと蓮が十年ぶりに駅で再会する。\n古い鍵はこの時点では意味を明かさない。",
          }),
        }),
        expect.objectContaining({
          name: "beats",
          value: expect.objectContaining({
            kind: "list",
            items: [
              { value: "ミオが駅に到着する" },
              { value: "蓮がミオに気づく" },
              { value: "古い鍵が落ちる" },
            ],
          }),
        }),
        expect.objectContaining({
          name: "order",
          value: expect.objectContaining({
            kind: "orderedList",
            items: [
              { number: 1, value: "再会" },
              { number: 2, value: "沈黙" },
              { number: 3, value: "鍵の発見" },
            ],
          }),
        }),
        expect.objectContaining({
          name: "outline",
          value: expect.objectContaining({
            kind: "list",
            items: [
              {
                value: "第一幕",
                children: [
                  {
                    kind: "list",
                    items: [{ value: "発端" }, { value: "葛藤" }],
                  },
                ],
              },
              {
                value: "第二幕",
                children: [
                  {
                    kind: "orderedList",
                    items: [
                      { number: 1, value: "調査" },
                      { number: 2, value: "発見", annotation: "注釈" },
                    ],
                  },
                ],
              },
            ],
          }),
        }),
      ]),
    );
  });

  it("parses mixed bracket field values as rich text", () => {
    const { document, diagnostics } = parseRosemary(`
"雨の日の再会"[scene]{
    summary: [
        長文・リストの記述を同時に許可する
        - リストとして認識する ^ リスト注釈
        - "リストとして認識する"
        1. 数字リストとして認識する
        2. "数字リストとして認識する。" ^ 数字リスト注釈
        ミオ >field内のセリフとして認識する ^ セリフ注釈
        蓮 >"引用付きでも認識する"
        ^ field内の注釈として認識する
        長文用の文字列として認識する。
        \\- リストではない文章
        \\1. 数字リストではない文章
        \\^ 注釈ではない文章
    ]
}
`);

    expect(diagnostics).toEqual([]);
    const scene = document.blocks[0]!;
    const summary = scene.entries.find(
      (entry) => entry.kind === "field" && entry.name === "summary",
    );

    expect(summary).toMatchObject({
      kind: "field",
      value: {
        kind: "richText",
        parts: [
          {
            kind: "paragraph",
            text: "長文・リストの記述を同時に許可する",
          },
          {
            kind: "list",
            items: [
              { value: "リストとして認識する", annotation: "リスト注釈" },
              { value: "リストとして認識する" },
            ],
          },
          {
            kind: "orderedList",
            items: [
              { number: 1, value: "数字リストとして認識する" },
              {
                number: 2,
                value: "数字リストとして認識する。",
                annotation: "数字リスト注釈",
              },
            ],
          },
          {
            kind: "dialogue",
            speaker: "ミオ",
            text: "field内のセリフとして認識する",
            annotation: "セリフ注釈",
          },
          {
            kind: "dialogue",
            speaker: "蓮",
            text: "引用付きでも認識する",
          },
          {
            kind: "annotation",
            value: "field内の注釈として認識する",
          },
          {
            kind: "paragraph",
            text:
              "長文用の文字列として認識する。\n- リストではない文章\n1. 数字リストではない文章\n^ 注釈ではない文章",
          },
        ],
      },
    });
  });
});

describe("parseRosemaryProject", () => {
  it("resolves included files for diagnostics and graph data", async () => {
    const project = await parseRosemaryProject(
      "/story/plot.rsmr",
      createMemoryLoader({
        "/story/plot.rsmr": `
@include "character.rsmr"

"雨の日の再会"[scene]{
    @ "佐倉ミオ"
}
`,
        "/story/character.rsmr": `
"佐倉ミオ"[character]{
    age: 17
}
`,
      }),
    );

    expect(project.diagnostics).toEqual([]);
    expect(project.files.map((file) => file.path)).toEqual([
      "/story/plot.rsmr",
      "/story/character.rsmr",
    ]);
    expect(project.document.blocks.map((block) => block.name)).toEqual([
      "雨の日の再会",
      "佐倉ミオ",
    ]);

    const graph = buildGraph(project.document);
    expect(graph.nodes.map((node) => node.name)).toEqual([
      "雨の日の再会",
      "佐倉ミオ",
    ]);
    expect(graph.edges[0]).toMatchObject({
      source: "雨の日の再会",
      target: "佐倉ミオ",
    });
  });

  it("reports circular includes", async () => {
    const project = await parseRosemaryProject(
      "/story/plot.rsmr",
      createMemoryLoader({
        "/story/plot.rsmr": '@include "character.rsmr"',
        "/story/character.rsmr": '@include "plot.rsmr"',
      }),
    );

    expect(project.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "circular-include",
          sourcePath: "/story/character.rsmr",
        }),
      ]),
    );
  });
});

describe("validateDocument", () => {
  it("reports undefined links and duplicate block names", () => {
    const { document } = parseRosemary(`
"A"{
    @ "Missing"
}
"A"{}
`);
    const diagnostics = validateDocument(document);

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "undefined-link-target" }),
        expect.objectContaining({ code: "duplicate-block-name" }),
      ]),
    );
  });
});

describe("buildGraph", () => {
  it("builds nodes and edges from parsed documents", () => {
    const { document } = parseRosemary(`
"A"{
    @ "B" <--"相互"-->
}
"B"{}
`);
    const graph = buildGraph(document);

    expect(graph.nodes.map((node) => node.name)).toEqual(["A", "B"]);
    expect(graph.edges[0]).toMatchObject({
      source: "A",
      target: "B",
      direction: "bidirectional",
      label: "相互",
    });
  });

  it("omits state blocks from graph nodes", () => {
    const { document } = parseRosemary(`
"佐倉ミオ"[character]{
    "第一章時点"[state, at="第一章"]{
        goal: "父の手がかりを探す"
    }
}
`);
    const graph = buildGraph(document);

    expect(graph.nodes.map((node) => node.name)).toEqual(["佐倉ミオ"]);
  });
});

function* walkBlocks(blocks: BlockNode[]): Generator<BlockNode> {
  for (const block of blocks) {
    yield block;
    for (const entry of block.entries) {
      if (entry.kind === "block") {
        yield* walkBlocks([entry]);
      }
    }
  }
}

function createMemoryLoader(files: Record<string, string>) {
  return {
    async readFile(filePath: string): Promise<string> {
      const normalized = normalizePath(filePath);
      const file = files[normalized];
      if (file === undefined) {
        throw new Error(`Missing file: ${normalized}`);
      }
      return file;
    },
    resolvePath(fromPath: string, includePath: string): string {
      return normalizePath(path.resolve(path.dirname(fromPath), includePath));
    },
    normalizePath,
  };
}

function normalizePath(filePath: string): string {
  return path.posix.normalize(filePath.replaceAll("\\", "/"));
}
