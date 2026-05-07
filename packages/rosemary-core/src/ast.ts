export interface Position {
  offset: number;
  line: number;
  column: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  range: Range;
  code?: string;
  sourcePath?: string;
}

export interface SourceInfo {
  path: string;
}

export interface RosemaryDocument {
  kind: "document";
  meta?: MetaBlock;
  includes: IncludeNode[];
  blocks: BlockNode[];
  diagnostics: Diagnostic[];
  range: Range;
  source?: SourceInfo;
}

export interface MetaBlock {
  kind: "meta";
  fields: FieldEntry[];
  range: Range;
  source?: SourceInfo;
}

export interface IncludeNode {
  kind: "include";
  path: string;
  range: Range;
  source?: SourceInfo;
}

export interface BlockNode {
  kind: "block";
  name: string;
  attributes: Attribute[];
  tags: Tag[];
  entries: BlockEntry[];
  range: Range;
  source?: SourceInfo;
}

export type BlockEntry =
  | TextEntry
  | FieldEntry
  | DialogueEntry
  | LinkEntry
  | QuestionEntry
  | AnswerEntry
  | AnnotationEntry
  | BlockNode;

export interface Attribute {
  kind: "attribute";
  name: string;
  value?: RosemaryValue;
  range: Range;
}

export interface Tag {
  kind: "tag";
  name: string;
  range: Range;
}

export type RosemaryValue =
  | StringValue
  | NumberValue
  | BooleanValue
  | IdentifierValue
  | MultilineTextValue
  | ListValue
  | OrderedListValue
  | RichTextValue;

export interface StringValue {
  kind: "string";
  value: string;
  raw: string;
  range: Range;
}

export interface NumberValue {
  kind: "number";
  value: number;
  raw: string;
  range: Range;
}

export interface BooleanValue {
  kind: "boolean";
  value: boolean;
  raw: string;
  range: Range;
}

export interface IdentifierValue {
  kind: "identifier";
  value: string;
  raw: string;
  range: Range;
}

export interface MultilineTextValue {
  kind: "multilineText";
  value: string;
  raw: string;
  range: Range;
}

export interface ListItem {
  value: string;
  annotation?: string;
  children?: Array<ListPart | OrderedListPart>;
}

export interface OrderedListItem extends ListItem {
  number: number;
}

export interface ListValue {
  kind: "list";
  items: ListItem[];
  raw: string;
  range: Range;
}

export interface OrderedListValue {
  kind: "orderedList";
  items: OrderedListItem[];
  raw: string;
  range: Range;
}

export type RichTextPart =
  | ParagraphPart
  | ListPart
  | OrderedListPart
  | DialoguePart
  | AnnotationPart;

export interface ParagraphPart {
  kind: "paragraph";
  text: string;
}

export interface ListPart {
  kind: "list";
  items: ListItem[];
}

export interface OrderedListPart {
  kind: "orderedList";
  items: OrderedListItem[];
}

export interface DialoguePart {
  kind: "dialogue";
  speaker: string;
  text: string;
  annotation?: string;
}

export interface AnnotationPart {
  kind: "annotation";
  value: string;
}

export interface RichTextValue {
  kind: "richText";
  parts: RichTextPart[];
  raw: string;
  range: Range;
}

export interface TextEntry {
  kind: "text";
  value: string;
  range: Range;
}

export interface FieldEntry {
  kind: "field";
  name: string;
  value: RosemaryValue;
  range: Range;
}

export interface DialogueEntry {
  kind: "dialogue";
  speaker: string;
  text: string;
  annotation?: string;
  range: Range;
}

export interface LinkEntry {
  kind: "link";
  target: string;
  attributes: Attribute[];
  tags: Tag[];
  line?: Line;
  range: Range;
}

export type LineStyle = "solid" | "dotted" | "bold";
export type LineDirection = "forward" | "bidirectional";

export interface Line {
  kind: "line";
  style: LineStyle;
  direction: LineDirection;
  label?: string;
  range: Range;
}

export interface QuestionEntry {
  kind: "question";
  value: string;
  range: Range;
}

export interface AnswerEntry {
  kind: "answer";
  value: string;
  range: Range;
}

export interface AnnotationEntry {
  kind: "annotation";
  value: string;
  range: Range;
}

export function hasAttribute(
  node: { attributes: Attribute[] },
  name: string,
): boolean {
  return node.attributes.some((attribute) => attribute.name === name);
}

export function getAttribute(
  node: { attributes: Attribute[] },
  name: string,
): Attribute | undefined {
  return node.attributes.find((attribute) => attribute.name === name);
}
