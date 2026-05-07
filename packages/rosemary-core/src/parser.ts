import {
  type AnswerEntry,
  type AnnotationEntry,
  type Attribute,
  type BlockEntry,
  type BlockNode,
  type Diagnostic,
  type DialogueEntry,
  type FieldEntry,
  type IncludeNode,
  type LinkEntry,
  type ListItem,
  type MetaBlock,
  type OrderedListItem,
  type QuestionEntry,
  type Range,
  type RichTextPart,
  type RosemaryDocument,
  type SourceInfo,
  type RosemaryValue,
  type StringValue,
  type Tag,
  type TextEntry,
} from "./ast.js";
import { type Token, tokenize } from "./tokenizer.js";

interface BracketGroup {
  attributes: Attribute[];
  tags: Tag[];
}

export interface ParseResult {
  document: RosemaryDocument;
  diagnostics: Diagnostic[];
}

export interface ParseOptions {
  sourcePath?: string;
}

export function parseRosemary(
  source: string,
  options: ParseOptions = {},
): ParseResult {
  const parser = new Parser(tokenize(source), source, options);
  const document = parser.parseDocument();
  return {
    document,
    diagnostics: document.diagnostics,
  };
}

class Parser {
  private index = 0;
  private readonly diagnostics: Diagnostic[] = [];
  private readonly sourceInfo: SourceInfo | undefined;

  constructor(
    private readonly tokens: Token[],
    private readonly source: string,
    options: ParseOptions,
  ) {
    this.sourceInfo = options.sourcePath
      ? { path: options.sourcePath }
      : undefined;
  }

  parseDocument(): RosemaryDocument {
    this.skipComments();
    const start = this.current().range.start;
    const meta = this.check("metaFence") ? this.parseMetaBlock() : undefined;
    const includes: IncludeNode[] = [];
    const blocks: BlockNode[] = [];

    while (!this.isAtEnd()) {
      this.skipComments();
      if (this.isAtEnd()) {
        break;
      }

      if (this.isIncludeStart()) {
        includes.push(this.parseInclude());
      } else if (this.check("string") && this.isBlockStartAt(this.index)) {
        blocks.push(this.parseBlock());
      } else {
        this.reportCurrent("Unexpected token at top level.", "unexpected-token");
        this.advance();
      }
    }

    const end = this.previous()?.range.end ?? start;
    const document: RosemaryDocument = {
      kind: "document",
      meta,
      includes,
      blocks,
      diagnostics: this.diagnostics,
      range: { start, end },
      source: this.sourceInfo,
    };

    return document;
  }

  private parseMetaBlock(): MetaBlock {
    const start = this.consume("metaFence", "Expected meta fence.").range.start;
    const fields: FieldEntry[] = [];

    while (!this.isAtEnd() && !this.check("metaFence")) {
      this.skipComments();
      if (this.check("metaFence") || this.isAtEnd()) {
        break;
      }

      if (this.isFieldStart()) {
        fields.push(this.parseField());
      } else {
        this.reportCurrent("Expected meta field.", "expected-meta-field");
        this.advance();
      }
    }

    const end = this.match("metaFence")
      ? this.previousOrCurrent().range.end
      : this.previousOrCurrent().range.end;

    return {
      kind: "meta",
      fields,
      range: { start, end },
      source: this.sourceInfo,
    };
  }

  private parseInclude(): IncludeNode {
    const at = this.consume("at", "Expected `@`.");
    this.consume("identifier", "Expected `include` after `@`.");
    const path = this.consume("string", "Expected include path.");

    return {
      kind: "include",
      path: valueOf(path),
      range: { start: at.range.start, end: path.range.end },
      source: this.sourceInfo,
    };
  }

  private parseBlock(): BlockNode {
    const nameToken = this.consume("string", "Expected block name.");
    const attributes: Attribute[] = [];
    const tags: Tag[] = [];

    while (this.check("openBracket")) {
      const group = this.parseBracketGroup();
      attributes.push(...group.attributes);
      tags.push(...group.tags);
    }

    if (!this.match("openBrace")) {
      this.reportCurrent("Expected `{` after block header.", "expected-block-body");
      return {
        kind: "block",
        name: valueOf(nameToken),
        attributes,
        tags,
        entries: [],
        source: this.sourceInfo,
        range: {
          start: nameToken.range.start,
          end: this.previousOrCurrent().range.end,
        },
      };
    }

    const entries: BlockEntry[] = [];
    while (!this.isAtEnd() && !this.check("closeBrace")) {
      this.skipComments();

      if (this.check("closeBrace") || this.isAtEnd()) {
        break;
      }

      if (this.check("string")) {
        if (this.isBlockStartAt(this.index)) {
          entries.push(this.parseBlock());
        } else {
          entries.push(this.parseText());
        }
      } else if (this.check("at")) {
        entries.push(this.parseLink());
      } else if (this.check("question")) {
        entries.push(this.parseQuestion());
      } else if (this.check("answer")) {
        entries.push(this.parseAnswer());
      } else if (this.check("annotation")) {
        entries.push(this.parseAnnotation());
      } else if (this.isDialogueStart()) {
        entries.push(this.parseDialogue());
      } else if (this.isFieldStart()) {
        entries.push(this.parseField());
      } else {
        this.reportCurrent("Unexpected token in block.", "unexpected-block-token");
        this.advance();
      }
    }

    const end = this.match("closeBrace")
      ? this.previousOrCurrent().range.end
      : this.previousOrCurrent().range.end;

    if (this.previous()?.kind !== "closeBrace") {
      this.diagnostics.push({
        severity: "error",
        message: "Block is missing a closing `}`.",
        range: nameToken.range,
        code: "missing-close-brace",
        sourcePath: this.sourceInfo?.path,
      });
    }

    return {
      kind: "block",
      name: valueOf(nameToken),
      attributes,
      tags,
      entries,
      range: { start: nameToken.range.start, end },
      source: this.sourceInfo,
    };
  }

  private parseBracketGroup(): BracketGroup {
    const open = this.consume("openBracket", "Expected `[`.");
    const attributes: Attribute[] = [];
    const tags: Tag[] = [];

    while (!this.isAtEnd() && !this.check("closeBracket")) {
      this.skipComments();

      if (this.match("comma")) {
        continue;
      }

      if (this.check("tag")) {
        const token = this.advance();
        tags.push({
          kind: "tag",
          name: valueOf(token),
          range: token.range,
        });
        continue;
      }

      if (this.check("identifier") || this.check("string")) {
        attributes.push(this.parseAttribute());
        continue;
      }

      this.reportCurrent("Expected attribute or tag.", "expected-attribute");
      this.advance();
    }

    if (!this.match("closeBracket")) {
      this.diagnostics.push({
        severity: "error",
        message: "Attribute or tag group is missing a closing `]`.",
        range: open.range,
        code: "missing-close-bracket",
        sourcePath: this.sourceInfo?.path,
      });
    }

    return { attributes, tags };
  }

  private parseAttribute(): Attribute {
    const name = this.advance();
    let value: RosemaryValue | undefined;
    let end = name.range.end;

    if (this.match("equals")) {
      value = this.parseValue();
      end = value.range.end;
    }

    return {
      kind: "attribute",
      name: valueOf(name),
      value,
      range: { start: name.range.start, end },
    };
  }

  private parseText(): TextEntry {
    const token = this.consume("string", "Expected text.");
    return {
      kind: "text",
      value: valueOf(token),
      range: token.range,
    };
  }

  private parseLink(): LinkEntry {
    const at = this.consume("at", "Expected `@`.");
    const target = this.consumeAny(["string", "identifier"], "Expected link target.");
    const attributes: Attribute[] = [];
    const tags: Tag[] = [];

    while (this.check("openBracket")) {
      const group = this.parseBracketGroup();
      attributes.push(...group.attributes);
      tags.push(...group.tags);
    }

    const line = this.check("line")
      ? (this.advance().value as LinkEntry["line"])
      : undefined;

    return {
      kind: "link",
      target: valueOf(target),
      attributes,
      tags,
      line,
      range: {
        start: at.range.start,
        end: line?.range.end ?? this.previousOrCurrent().range.end,
      },
    };
  }

  private parseQuestion(): QuestionEntry {
    const start = this.consume("question", "Expected `?`.");
    const text = this.parseInlineTextValue();
    if (!text) {
      this.reportCurrent("Expected question text.", "expected-question-text");
      return {
        kind: "question",
        value: "",
        range: { start: start.range.start, end: start.range.end },
      };
    }

    return {
      kind: "question",
      value: text.text,
      range: { start: start.range.start, end: text.range.end },
    };
  }

  private parseAnswer(): AnswerEntry {
    const start = this.consume("answer", "Expected `!`.");
    const text = this.parseInlineTextValue();
    if (!text) {
      this.reportCurrent("Expected answer text.", "expected-answer-text");
      return {
        kind: "answer",
        value: "",
        range: { start: start.range.start, end: start.range.end },
      };
    }

    return {
      kind: "answer",
      value: text.text,
      range: { start: start.range.start, end: text.range.end },
    };
  }

  private parseAnnotation(): AnnotationEntry {
    const start = this.consume("annotation", "Expected `^`.");
    const text = this.parseInlineTextValue();
    if (!text) {
      this.reportCurrent("Expected annotation text.", "expected-annotation-text");
      return {
        kind: "annotation",
        value: "",
        range: { start: start.range.start, end: start.range.end },
      };
    }

    return {
      kind: "annotation",
      value: text.text,
      range: { start: start.range.start, end: text.range.end },
    };
  }

  private parseDialogue(): DialogueEntry {
    const name = this.consumeAny(["identifier", "string"], "Expected dialogue speaker.");
    this.consume("dialogueMarker", "Expected `>` after dialogue speaker.");
    const speaker = valueOf(name);
    const dialogueText = this.parseInlineTextValue({
      disallowLeadingOpenBracket: true,
      parseTrailingAnnotation: true,
    });

    if (!dialogueText) {
      this.reportCurrent("Expected dialogue text.", "expected-dialogue-text");
      return {
        kind: "dialogue",
        speaker,
        text: "",
        range: {
          start: name.range.start,
          end: this.previousOrCurrent().range.end,
        },
      };
    }

    return {
      kind: "dialogue",
      speaker,
      text: dialogueText.text,
      annotation: dialogueText.annotation,
      range: {
        start: name.range.start,
        end: dialogueText.range.end,
      },
    };
  }

  private parseField(): FieldEntry {
    const name = this.consumeAny(["identifier", "string"], "Expected field name.");
    this.consume("colon", "Expected `:` after field name.");
    const value = this.parseValue();
    const range: Range = {
      start: name.range.start,
      end: value.range.end,
    };

    return {
      kind: "field",
      name: valueOf(name),
      value,
      range,
    };
  }

  private parseInlineTextValue(
    options: {
      disallowLeadingOpenBracket?: boolean;
      parseTrailingAnnotation?: boolean;
    } = {},
  ): { text: string; annotation?: string; range: Range } | undefined {
    if (this.check("string") && options.parseTrailingAnnotation !== true) {
      const value = this.parseValue();
      if (value.kind !== "string") {
        return undefined;
      }

      return {
        text: value.value,
        range: value.range,
      };
    }

    const first = this.current();
    if (
      first.kind === "eof" ||
      first.kind === "closeBrace" ||
      (options.disallowLeadingOpenBracket === true && first.kind === "openBracket") ||
      first.kind === "comment"
    ) {
      return undefined;
    }

    const line = first.range.start.line;
    const startOffset = first.range.start.offset;
    let cursor = this.index;
    let endOffset = first.range.end.offset;
    let end = first.range.end;

    while (cursor < this.tokens.length) {
      const token = this.tokens[cursor];
      if (
        !token ||
        token.kind === "eof" ||
        token.kind === "comment" ||
        token.kind === "closeBrace" ||
        token.range.start.line !== line
      ) {
        break;
      }

      endOffset = token.range.end.offset;
      end = token.range.end;
      cursor += 1;
    }

    if (cursor === this.index) {
      return undefined;
    }

    this.index = cursor;
    const rawText = this.source.slice(startOffset, endOffset).trim();
    const parsedText =
      options.parseTrailingAnnotation === true
        ? splitInlineAnnotation(rawText)
        : { value: rawText };

    return {
      text: normalizeInlineText(parsedText.value),
      annotation:
        parsedText.annotation === undefined
          ? undefined
          : normalizeInlineText(parsedText.annotation),
      range: {
        start: first.range.start,
        end,
      },
    };
  }

  private parseValue(): RosemaryValue {
    if (this.check("openBracket")) {
      return this.parseBracketValue();
    }

    if (this.check("string")) {
      const token = this.advance();
      return {
        kind: "string",
        value: valueOf(token),
        raw: token.lexeme,
        range: token.range,
      } satisfies StringValue;
    }

    if (this.check("number")) {
      const token = this.advance();
      return {
        kind: "number",
        value: Number(token.value),
        raw: token.lexeme,
        range: token.range,
      };
    }

    if (this.check("boolean")) {
      const token = this.advance();
      return {
        kind: "boolean",
        value: Boolean(token.value),
        raw: token.lexeme,
        range: token.range,
      };
    }

    if (this.check("identifier")) {
      const token = this.advance();
      return {
        kind: "identifier",
        value: valueOf(token),
        raw: token.lexeme,
        range: token.range,
      };
    }

    this.reportCurrent("Expected value.", "expected-value");
    const token = this.advance();
    return {
      kind: "identifier",
      value: "",
      raw: token.lexeme,
      range: token.range,
    };
  }

  private parseBracketValue(): RosemaryValue {
    const open = this.consume("openBracket", "Expected `[`.");
    const close = this.findStandaloneCloseBracketToken();
    const contentEndOffset = close?.range.start.offset ?? this.source.length;
    const raw = this.source.slice(open.range.end.offset, contentEndOffset);
    const end = close?.range.end ?? this.tokens[this.tokens.length - 1]!.range.end;

    if (!close) {
      this.diagnostics.push({
        severity: "error",
        message: "Multiline field value is missing a closing `]` line.",
        range: open.range,
        code: "missing-field-value-close-bracket",
        sourcePath: this.sourceInfo?.path,
      });
      this.advanceUntilOffset(this.source.length);
    } else {
      this.advanceUntilOffset(close.range.end.offset);
    }

    const normalizedContent = normalizeBracketValueContent(raw);
    const parts = parseRichTextParts(normalizedContent);
    const range = {
      start: open.range.start,
      end,
    };

    if (parts.length === 1 && parts[0]?.kind === "list") {
      return {
        kind: "list",
        items: parts[0].items,
        raw,
        range,
      };
    }

    if (parts.length === 1 && parts[0]?.kind === "orderedList") {
      return {
        kind: "orderedList",
        items: parts[0].items,
        raw,
        range,
      };
    }

    if (
      parts.length > 1 ||
      parts[0]?.kind === "dialogue" ||
      parts[0]?.kind === "annotation"
    ) {
      return {
        kind: "richText",
        parts,
        raw,
        range,
      };
    }

    return {
      kind: "multilineText",
      value:
        parts[0]?.kind === "paragraph" ? parts[0].text : normalizedContent,
      raw,
      range,
    };
  }

  private findStandaloneCloseBracketToken(): Token | undefined {
    for (let cursor = this.index; cursor < this.tokens.length; cursor += 1) {
      const token = this.tokens[cursor];
      if (!token || token.kind === "eof") {
        return undefined;
      }

      if (token.kind === "closeBracket" && this.isStandaloneLineToken(token)) {
        return token;
      }
    }

    return undefined;
  }

  private isStandaloneLineToken(token: Token): boolean {
    const lineStart = this.source.lastIndexOf("\n", token.range.start.offset - 1) + 1;
    const nextNewline = this.source.indexOf("\n", token.range.end.offset);
    const lineEnd = nextNewline === -1 ? this.source.length : nextNewline;
    const before = this.source.slice(lineStart, token.range.start.offset);
    const after = this.source.slice(token.range.end.offset, lineEnd);

    return before.trim().length === 0 && after.trim().length === 0;
  }

  private advanceUntilOffset(offset: number): void {
    while (!this.isAtEnd() && this.current().range.start.offset < offset) {
      this.advance();
    }
  }

  private isBlockStartAt(index: number): boolean {
    if (this.tokens[index]?.kind !== "string") {
      return false;
    }

    let cursor = index + 1;
    cursor = this.skipCommentIndex(cursor);

    while (this.tokens[cursor]?.kind === "openBracket") {
      let depth = 0;
      do {
        if (this.tokens[cursor]?.kind === "openBracket") {
          depth += 1;
        } else if (this.tokens[cursor]?.kind === "closeBracket") {
          depth -= 1;
        }
        cursor += 1;
      } while (
        cursor < this.tokens.length &&
        depth > 0 &&
        this.tokens[cursor - 1]?.kind !== "eof"
      );
      cursor = this.skipCommentIndex(cursor);
    }

    return this.tokens[cursor]?.kind === "openBrace";
  }

  private isFieldStart(): boolean {
    if (!this.check("identifier") && !this.check("string")) {
      return false;
    }

    return this.tokens[this.index + 1]?.kind === "colon";
  }

  private isDialogueStart(): boolean {
    if (!this.check("identifier") && !this.check("string")) {
      return false;
    }

    return this.tokens[this.index + 1]?.kind === "dialogueMarker";
  }

  private isIncludeStart(): boolean {
    return (
      this.check("at") &&
      this.tokens[this.index + 1]?.kind === "identifier" &&
      valueOf(this.tokens[this.index + 1]!) === "include"
    );
  }

  private skipCommentIndex(index: number): number {
    let cursor = index;
    while (this.tokens[cursor]?.kind === "comment") {
      cursor += 1;
    }
    return cursor;
  }

  private skipComments(): void {
    while (this.check("comment")) {
      this.advance();
    }
  }

  private consume(kind: Token["kind"], message: string): Token {
    if (this.check(kind)) {
      return this.advance();
    }

    this.reportCurrent(message, "unexpected-token");
    return this.advance();
  }

  private consumeAny(kinds: Token["kind"][], message: string): Token {
    for (const kind of kinds) {
      if (this.check(kind)) {
        return this.advance();
      }
    }

    this.reportCurrent(message, "unexpected-token");
    return this.advance();
  }

  private match(kind: Token["kind"]): boolean {
    if (!this.check(kind)) {
      return false;
    }
    this.advance();
    return true;
  }

  private check(kind: Token["kind"]): boolean {
    return this.current().kind === kind;
  }

  private current(): Token {
    return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1]!;
  }

  private previous(): Token | undefined {
    return this.tokens[this.index - 1];
  }

  private previousOrCurrent(): Token {
    return this.previous() ?? this.current();
  }

  private advance(): Token {
    if (!this.isAtEnd()) {
      this.index += 1;
    }
    return this.tokens[this.index - 1] ?? this.tokens[this.tokens.length - 1]!;
  }

  private isAtEnd(): boolean {
    return this.current().kind === "eof";
  }

  private reportCurrent(message: string, code: string): void {
    this.diagnostics.push({
      severity: "error",
      message,
      range: this.current().range,
      code,
      sourcePath: this.sourceInfo?.path,
    });
  }
}

function normalizeBracketValueContent(raw: string): string {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");

  if (lines[0]?.trim().length === 0) {
    lines.shift();
  }

  while (lines.length > 0 && lines[lines.length - 1]?.trim().length === 0) {
    lines.pop();
  }

  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  const commonIndent = Math.min(
    ...nonEmptyLines.map((line) => leadingWhitespaceLength(line)),
  );
  const indent = Number.isFinite(commonIndent) ? commonIndent : 0;

  return lines.map((line) => line.slice(Math.min(indent, line.length))).join("\n");
}

function parseRichTextParts(content: string): RichTextPart[] {
  const parts: RichTextPart[] = [];
  let paragraphLines: string[] = [];
  let listStack: ListStackEntry[] = [];

  const flushParagraph = (): void => {
    while (paragraphLines.length > 0 && paragraphLines[paragraphLines.length - 1]?.trim() === "") {
      paragraphLines.pop();
    }

    if (paragraphLines.length === 0) {
      return;
    }

    parts.push({
      kind: "paragraph",
      text: paragraphLines.join("\n"),
    });
    paragraphLines = [];
  };

  const closeLists = (): void => {
    listStack = [];
  };

  const flushAllOpenParts = (): void => {
    flushParagraph();
    closeLists();
  };

  const addListLine = (line: ParsedListLine): void => {
    flushParagraph();

    while (
      listStack.length > 0 &&
      listStack[listStack.length - 1]!.indent > line.indent
    ) {
      listStack.pop();
    }

    if (
      listStack.length > 0 &&
      listStack[listStack.length - 1]!.indent === line.indent &&
      listStack[listStack.length - 1]!.kind !== line.kind
    ) {
      listStack.pop();
    }

    const parent = listStack[listStack.length - 1];
    if (!parent || parent.indent < line.indent) {
      const part = createListPart(line.kind);
      if (parent && parent.indent < line.indent) {
        const parentItem = parent.items[parent.items.length - 1];
        if (parentItem) {
          parentItem.children = parentItem.children ?? [];
          parentItem.children.push(part);
        } else {
          parts.push(part);
        }
      } else {
        parts.push(part);
      }

      if (part.kind === "list") {
        listStack.push({
          kind: "list",
          indent: line.indent,
          items: part.items,
        });
      } else {
        listStack.push({
          kind: "orderedList",
          indent: line.indent,
          items: part.items,
        });
      }
    }

    const current = listStack[listStack.length - 1]!;
    if (current.kind === "orderedList" && line.kind === "orderedList") {
      current.items.push({
        number: line.number,
        value: line.item.value,
        annotation: line.item.annotation,
      });
      return;
    }

    if (current.kind === "list" && line.kind === "list") {
      current.items.push(line.item);
    }
  };

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed) {
      closeLists();
      if (paragraphLines.length > 0) {
        paragraphLines.push("");
      }
      continue;
    }

    const escapedText = parseEscapedTextLine(trimmed);
    if (escapedText !== undefined) {
      closeLists();
      paragraphLines.push(escapedText);
      continue;
    }

    const dialogue = parseDialogueLine(trimmed);
    if (dialogue) {
      flushAllOpenParts();
      parts.push(dialogue);
      continue;
    }

    const annotation = parseAnnotationLine(trimmed);
    if (annotation) {
      flushAllOpenParts();
      parts.push(annotation);
      continue;
    }

    const listLine = parseListLine(line);
    if (listLine) {
      addListLine(listLine);
      continue;
    }

    closeLists();
    paragraphLines.push(trimmed);
  }

  flushParagraph();
  closeLists();

  return parts;
}

type ParsedListKind = "list" | "orderedList";
type ParsedListPart = Extract<RichTextPart, { kind: ParsedListKind }>;

type ListStackEntry =
  | {
      kind: "list";
      indent: number;
      items: ListItem[];
    }
  | {
      kind: "orderedList";
      indent: number;
      items: OrderedListItem[];
    };

interface ParsedListLine {
  kind: ParsedListKind;
  indent: number;
  number: number;
  item: ListItem;
}

function parseListLine(line: string): ParsedListLine | undefined {
  const content = line.trimStart();
  const indent = leadingWhitespaceColumn(line);

  const unorderedItem = /^-\s+(.*)$/.exec(content);
  if (unorderedItem) {
    return {
      kind: "list",
      indent,
      number: 0,
      item: parseAnnotatedText(unorderedItem[1] ?? ""),
    };
  }

  const orderedItem = /^(\d+)\.\s+(.*)$/.exec(content);
  if (orderedItem) {
    return {
      kind: "orderedList",
      indent,
      number: Number(orderedItem[1]),
      item: parseAnnotatedText(orderedItem[2] ?? ""),
    };
  }

  return undefined;
}

function createListPart(kind: ParsedListKind): ParsedListPart {
  return kind === "list"
    ? {
        kind: "list",
        items: [],
      }
    : {
        kind: "orderedList",
        items: [],
      };
}

function parseDialogueLine(value: string): RichTextPart | undefined {
  const match = /^((?:"(?:\\.|[^"\\])*")|[^\s>{}\[\](),:=@#?!"]+)\s*>\s*(.*)$/.exec(
    value,
  );
  if (!match) {
    return undefined;
  }

  return {
    kind: "dialogue",
    speaker: normalizeListItemText(match[1] ?? ""),
    ...parseAnnotatedText(match[2] ?? "", "text"),
  };
}

function parseAnnotationLine(value: string): RichTextPart | undefined {
  const match = /^\^\s*(.*)$/.exec(value);
  if (!match) {
    return undefined;
  }

  return {
    kind: "annotation",
    value: normalizeListItemText(match[1] ?? ""),
  };
}

function normalizeListItemText(value: string): string {
  const trimmed = value.trim();
  if (/^"(?:\\.|[^"\\])*"$/.test(trimmed)) {
    return decodeEscapes(trimmed.slice(1, -1));
  }
  return trimmed.replace(/\\\^/g, "^");
}

function normalizeInlineText(value: string): string {
  return normalizeListItemText(value);
}

function parseAnnotatedText(
  value: string,
): { value: string; annotation?: string };
function parseAnnotatedText(
  value: string,
  valueKey: "value",
): { value: string; annotation?: string };
function parseAnnotatedText(
  value: string,
  valueKey: "text",
): { text: string; annotation?: string };
function parseAnnotatedText(
  value: string,
  valueKey: "value" | "text" = "value",
): { value?: string; text?: string; annotation?: string } {
  const parsed = splitInlineAnnotation(value);
  const result = {
    [valueKey]: normalizeInlineText(parsed.value),
    annotation:
      parsed.annotation === undefined
        ? undefined
        : normalizeInlineText(parsed.annotation),
  };

  return result;
}

function splitInlineAnnotation(value: string): {
  value: string;
  annotation?: string;
} {
  let escaped = false;
  let inString = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (char === "^" && !inString) {
      return {
        value: value.slice(0, index).trim(),
        annotation: value.slice(index + 1).trim(),
      };
    }
  }

  return {
    value: value.trim(),
  };
}

function parseEscapedTextLine(value: string): string | undefined {
  if (/^\\-\s+/.test(value) || /^\\\d+\.\s+/.test(value) || /^\\\^/.test(value)) {
    return value.slice(1);
  }

  return undefined;
}

function leadingWhitespaceLength(value: string): number {
  return value.match(/^[ \t]*/)?.[0].length ?? 0;
}

function leadingWhitespaceColumn(value: string): number {
  let column = 0;

  for (const char of value) {
    if (char === " ") {
      column += 1;
    } else if (char === "\t") {
      column += 4;
    } else {
      break;
    }
  }

  return column;
}

function valueOf(token: Token): string {
  return String(token.value ?? token.lexeme);
}

function decodeEscapes(value: string): string {
  return value.replace(/\\(.)/g, (_, char: string) => {
    if (char === "n") {
      return "\n";
    }
    if (char === "t") {
      return "\t";
    }
    return char;
  });
}
