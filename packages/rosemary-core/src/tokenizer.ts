import type { Line, LineDirection, LineStyle, Range } from "./ast.js";

export type TokenKind =
  | "string"
  | "identifier"
  | "number"
  | "boolean"
  | "tag"
  | "line"
  | "comment"
  | "metaFence"
  | "openBrace"
  | "closeBrace"
  | "openBracket"
  | "closeBracket"
  | "openParen"
  | "closeParen"
  | "comma"
  | "colon"
  | "equals"
  | "at"
  | "question"
  | "answer"
  | "annotation"
  | "dialogueMarker"
  | "unknown"
  | "eof";

export interface Token {
  kind: TokenKind;
  lexeme: string;
  range: Range;
  value?: unknown;
}

interface Cursor {
  offset: number;
  line: number;
  column: number;
}

export function tokenize(source: string): Token[] {
  return new Scanner(source).scan();
}

class Scanner {
  private readonly tokens: Token[] = [];
  private index = 0;
  private line = 1;
  private column = 1;

  constructor(private readonly source: string) {}

  scan(): Token[] {
    while (!this.isAtEnd()) {
      if (this.consumeWhitespace()) {
        continue;
      }

      const start = this.cursor();

      if (this.startsWith("//")) {
        this.scanComment(start);
      } else if (this.scanLabeledLine(start, '--"', '"-->', "solid", "forward")) {
        continue;
      } else if (this.scanLabeledLine(start, '-."', '"-.->', "dotted", "forward")) {
        continue;
      } else if (this.scanLabeledLine(start, '=="', '"==>', "bold", "forward")) {
        continue;
      } else if (
        this.scanLabeledLine(start, '<--"', '"-->', "solid", "bidirectional")
      ) {
        continue;
      } else if (this.scanPlainLine(start, "<-->", "solid", "bidirectional")) {
        continue;
      } else if (this.scanPlainLine(start, "-->", "solid", "forward")) {
        continue;
      } else if (this.scanPlainLine(start, "-.->", "dotted", "forward")) {
        continue;
      } else if (this.scanPlainLine(start, "==>", "bold", "forward")) {
        continue;
      } else if (this.startsWith("---")) {
        this.addFixed("metaFence", start, 3);
      } else {
        this.scanToken(start);
      }
    }

    const end = this.cursor();
    this.tokens.push({
      kind: "eof",
      lexeme: "",
      range: { start: end, end },
    });
    return this.tokens;
  }

  private scanToken(start: Cursor): void {
    const char = this.peek();

    if (char === '"') {
      this.scanString(start);
      return;
    }

    if (char === "#") {
      this.scanTag(start);
      return;
    }

    if (this.isNumberStart(char)) {
      this.scanNumber(start);
      return;
    }

    if (this.isIdentifierStart(char)) {
      this.scanIdentifier(start);
      return;
    }

    const punctuation: Record<string, TokenKind> = {
      "{": "openBrace",
      "}": "closeBrace",
      "[": "openBracket",
      "]": "closeBracket",
      "(": "openParen",
      ")": "closeParen",
      ",": "comma",
      ":": "colon",
      "=": "equals",
      "@": "at",
      "?": "question",
      "!": "answer",
      "^": "annotation",
      ">": "dialogueMarker",
    };

    const kind = punctuation[char];
    if (kind) {
      this.advance();
      this.tokens.push({
        kind,
        lexeme: char,
        range: this.rangeFrom(start),
      });
      return;
    }

    this.advance();
    this.tokens.push({
      kind: "unknown",
      lexeme: char,
      range: this.rangeFrom(start),
      value: char,
    });
  }

  private scanString(start: Cursor): void {
    this.advance();
    let value = "";
    let escaped = false;

    while (!this.isAtEnd()) {
      const char = this.advance();

      if (escaped) {
        value += this.decodeEscape(char);
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"') {
        const lexeme = this.source.slice(start.offset, this.index);
        this.tokens.push({
          kind: "string",
          lexeme,
          range: this.rangeFrom(start),
          value,
        });
        return;
      }

      value += char;
    }

    this.tokens.push({
      kind: "string",
      lexeme: this.source.slice(start.offset, this.index),
      range: this.rangeFrom(start),
      value,
    });
  }

  private scanTag(start: Cursor): void {
    this.advance();

    while (!this.isAtEnd() && !this.isDelimiter(this.peek())) {
      this.advance();
    }

    const lexeme = this.source.slice(start.offset, this.index);
    this.tokens.push({
      kind: "tag",
      lexeme,
      range: this.rangeFrom(start),
      value: lexeme.slice(1),
    });
  }

  private scanNumber(start: Cursor): void {
    if (this.peek() === "-") {
      this.advance();
    }

    while (!this.isAtEnd() && this.isDigit(this.peek())) {
      this.advance();
    }

    if (this.peek() === "." && this.isDigit(this.peekNext())) {
      this.advance();
      while (!this.isAtEnd() && this.isDigit(this.peek())) {
        this.advance();
      }
    }

    const lexeme = this.source.slice(start.offset, this.index);
    this.tokens.push({
      kind: "number",
      lexeme,
      range: this.rangeFrom(start),
      value: Number(lexeme),
    });
  }

  private scanIdentifier(start: Cursor): void {
    while (!this.isAtEnd() && !this.isDelimiter(this.peek())) {
      this.advance();
    }

    const lexeme = this.source.slice(start.offset, this.index);
    const kind =
      lexeme === "true" || lexeme === "false" ? "boolean" : "identifier";
    this.tokens.push({
      kind,
      lexeme,
      range: this.rangeFrom(start),
      value: kind === "boolean" ? lexeme === "true" : lexeme,
    });
  }

  private scanComment(start: Cursor): void {
    while (!this.isAtEnd() && this.peek() !== "\n") {
      this.advance();
    }

    const lexeme = this.source.slice(start.offset, this.index);
    this.tokens.push({
      kind: "comment",
      lexeme,
      range: this.rangeFrom(start),
      value: lexeme.slice(2).trim(),
    });
  }

  private scanPlainLine(
    start: Cursor,
    lexeme: string,
    style: LineStyle,
    direction: LineDirection,
  ): boolean {
    if (!this.startsWith(lexeme)) {
      return false;
    }

    this.advanceMany(lexeme.length);
    this.tokens.push({
      kind: "line",
      lexeme,
      range: this.rangeFrom(start),
      value: {
        kind: "line",
        style,
        direction,
        range: this.rangeFrom(start),
      } satisfies Line,
    });
    return true;
  }

  private scanLabeledLine(
    start: Cursor,
    prefix: string,
    suffix: string,
    style: LineStyle,
    direction: LineDirection,
  ): boolean {
    if (!this.startsWith(prefix)) {
      return false;
    }

    const labelStart = this.index + prefix.length;
    const suffixStart = this.source.indexOf(suffix, labelStart);
    if (suffixStart === -1) {
      return false;
    }

    this.advanceMany(prefix.length);
    const rawLabel = this.source.slice(labelStart, suffixStart);
    this.advanceMany(rawLabel.length + suffix.length);
    const lexeme = this.source.slice(start.offset, this.index);
    this.tokens.push({
      kind: "line",
      lexeme,
      range: this.rangeFrom(start),
      value: {
        kind: "line",
        style,
        direction,
        label: decodeEscapes(rawLabel),
        range: this.rangeFrom(start),
      } satisfies Line,
    });
    return true;
  }

  private consumeWhitespace(): boolean {
    let consumed = false;

    while (!this.isAtEnd()) {
      const char = this.peek();
      if (char !== " " && char !== "\t" && char !== "\r" && char !== "\n") {
        break;
      }

      this.advance();
      consumed = true;
    }

    return consumed;
  }

  private addFixed(kind: TokenKind, start: Cursor, length: number): void {
    this.advanceMany(length);
    this.tokens.push({
      kind,
      lexeme: this.source.slice(start.offset, this.index),
      range: this.rangeFrom(start),
    });
  }

  private startsWith(value: string): boolean {
    return this.source.startsWith(value, this.index);
  }

  private isAtEnd(): boolean {
    return this.index >= this.source.length;
  }

  private peek(): string {
    return this.source[this.index] ?? "\0";
  }

  private peekNext(): string {
    return this.source[this.index + 1] ?? "\0";
  }

  private advance(): string {
    const char = this.source[this.index] ?? "\0";
    this.index += 1;

    if (char === "\n") {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }

    return char;
  }

  private advanceMany(length: number): void {
    for (let offset = 0; offset < length; offset += 1) {
      this.advance();
    }
  }

  private cursor(): Cursor {
    return {
      offset: this.index,
      line: this.line,
      column: this.column,
    };
  }

  private rangeFrom(start: Cursor): Range {
    return {
      start: { ...start },
      end: { ...this.cursor() },
    };
  }

  private isNumberStart(char: string): boolean {
    return this.isDigit(char) || (char === "-" && this.isDigit(this.peekNext()));
  }

  private isDigit(char: string): boolean {
    return char >= "0" && char <= "9";
  }

  private isIdentifierStart(char: string): boolean {
    return !this.isDelimiter(char) && char !== "\0";
  }

  private isDelimiter(char: string): boolean {
    return (
      char === "\0" ||
      /\s/.test(char) ||
      "{}[](),:=@#?!^\"".includes(char) ||
      char === "<" ||
      char === ">" ||
      char === "-"
    );
  }

  private decodeEscape(char: string): string {
    if (char === "n") {
      return "\n";
    }
    if (char === "t") {
      return "\t";
    }
    return char;
  }
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
