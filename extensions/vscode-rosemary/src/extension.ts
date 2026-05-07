import * as path from "node:path";
import * as vscode from "vscode";
import {
  buildGraph,
  parseRosemary,
  parseRosemaryProject,
  type BlockEntry,
  type BlockNode,
  type Diagnostic as RosemaryDiagnostic,
  type DialogueEntry,
  type FieldEntry,
  type GraphEdge,
  type GraphModel,
  type GraphNode,
  type LinkEntry,
  type MetaBlock,
  type RichTextPart,
  type RosemaryProject,
  type RosemaryProjectLoader,
  type RosemaryDocument,
} from "@rosemary/core";

const ROSEMARY_LANGUAGE_ID = "rosemary";

const previewPanels = new Set<RosemaryPreviewPanel>();

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection("rosemary");
  const blockReferenceHighlighter = new BlockReferenceHighlighter();
  context.subscriptions.push(diagnostics, blockReferenceHighlighter);

  const refreshDiagnostics = (document: vscode.TextDocument): void => {
    if (!isRosemaryDocument(document)) {
      return;
    }

    void parseProjectForDocument(document).then((project) => {
      setProjectDiagnostics(diagnostics, project, document.uri);
    });
  };

  const refreshDocumentFeatures = (document: vscode.TextDocument): void => {
    refreshDiagnostics(document);
    blockReferenceHighlighter.scheduleRefresh(document);
  };

  vscode.workspace.textDocuments.forEach(refreshDocumentFeatures);
  const rsmrWatcher = vscode.workspace.createFileSystemWatcher("**/*.rsmr");

  context.subscriptions.push(
    rsmrWatcher,
    vscode.languages.registerFoldingRangeProvider(
      ROSEMARY_LANGUAGE_ID,
      new RosemaryFoldingRangeProvider(),
    ),
    vscode.languages.registerHoverProvider(
      ROSEMARY_LANGUAGE_ID,
      new RosemaryBlockReferenceHoverProvider(),
    ),
    vscode.workspace.onDidOpenTextDocument(refreshDocumentFeatures),
    vscode.workspace.onDidChangeTextDocument((event) => {
      refreshDocumentFeatures(event.document);
      if (isRosemaryListEditingEnabled()) {
        void maybeHandleRosemaryListEnterChange(event);
      }
      forEachPreviewPanel((panel) => {
        panel.refreshForPotentialProjectChange(event.document);
      });
    }),
    rsmrWatcher.onDidChange((uri) => {
      forEachPreviewPanel((panel) => {
        panel.refreshForPotentialProjectFile(uri);
      });
      blockReferenceHighlighter.refreshVisibleEditors();
    }),
    rsmrWatcher.onDidCreate((uri) => {
      forEachPreviewPanel((panel) => {
        panel.refreshForPotentialProjectFile(uri);
      });
      blockReferenceHighlighter.refreshVisibleEditors();
    }),
    rsmrWatcher.onDidDelete((uri) => {
      forEachPreviewPanel((panel) => {
        panel.refreshForPotentialProjectFile(uri);
      });
      blockReferenceHighlighter.refreshVisibleEditors();
    }),
    vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
      forEachPreviewPanel((panel) => {
        panel.syncFromVisibleRanges(
          event.textEditor.document,
          event.visibleRanges,
        );
      });
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      forEachPreviewPanel((panel) => {
        panel.syncFromSelection(event.textEditor);
      });
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      diagnostics.delete(document.uri);
      blockReferenceHighlighter.clearDocument(document);
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => {
      blockReferenceHighlighter.refreshVisibleEditors();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("rosemary.blockReferenceHighlight")) {
        blockReferenceHighlighter.reloadConfiguration();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        blockReferenceHighlighter.scheduleRefresh(editor.document);
        forEachPreviewPanel((panel) => {
          panel.refreshForPotentialProjectChange(editor.document);
          panel.syncFromVisibleRanges(editor.document, editor.visibleRanges);
          panel.syncFromSelection(editor);
        });
      }
    }),
    vscode.commands.registerCommand("rosemary.openPreview", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showWarningMessage("Open a .rsmr file first.");
        return;
      }

      if (!isRosemaryDocument(editor.document)) {
        void vscode.window.showWarningMessage("The active file is not a ROSEMARY file.");
        return;
      }

      let panel: RosemaryPreviewPanel;
      panel = RosemaryPreviewPanel.open(
        context.extensionUri,
        editor.document,
        () => {
          previewPanels.delete(panel);
        },
      );
      previewPanels.add(panel);
      panel.syncFromVisibleRanges(editor.document, editor.visibleRanges);
      panel.syncFromSelection(editor);
    }),
    vscode.commands.registerCommand("rosemary.handleEnter", () => {
      void handleRosemaryEnter();
    }),
    vscode.commands.registerCommand("rosemary.handleTab", () => {
      void handleRosemaryTab();
    }),
    vscode.commands.registerCommand("rosemary.jumpToBlockDefinition", () => {
      void jumpToBlockDefinitionAtCursor();
    }),
  );
}

export function deactivate(): void {
  forEachPreviewPanel((panel) => {
    panel.dispose();
  });
  previewPanels.clear();
}

function forEachPreviewPanel(callback: (panel: RosemaryPreviewPanel) => void): void {
  for (const panel of [...previewPanels]) {
    callback(panel);
  }
}

class RosemaryFoldingRangeProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
    if (!isRosemaryDocument(document)) {
      return [];
    }

    const { document: parsedDocument } = parseRosemary(document.getText(), {
      sourcePath: normalizeFilePath(document.fileName),
    });

    return collectBlockFoldingRanges(parsedDocument.blocks);
  }
}

class RosemaryBlockReferenceHoverProvider implements vscode.HoverProvider {
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    if (!isRosemaryDocument(document)) {
      return undefined;
    }

    const config = loadBlockReferenceHighlightConfig();
    if (!config.enabled) {
      return undefined;
    }

    let project: RosemaryProject;
    try {
      project = await parseProjectForDocument(document);
    } catch (error) {
      console.error(`[ROSEMARY] Failed to resolve block reference hover.`, error);
      return undefined;
    }

    const sourceText = document.getText();
    const sourcePath = normalizeFilePath(document.fileName);
    const targets = collectBlockReferenceTargets(project, config);
    const searchRanges = collectBlockReferenceSearchRanges(
      project.document.blocks,
      sourcePath,
    );
    const offset = document.offsetAt(position);
    const matches = dedupeBlockReferenceMatches(
      findBlockReferenceMatchesAtOffset(sourceText, searchRanges, targets, offset),
    );

    if (!matches.length) {
      return undefined;
    }

    const markdown = new vscode.MarkdownString(undefined, true);
    markdown.supportThemeIcons = true;
    markdown.isTrusted = false;
    markdown.appendMarkdown(
      matches
        .map((match) => formatBlockReferenceHover(match.target, project.entryPath))
        .join("\n\n---\n\n"),
    );

    return new vscode.Hover(markdown);
  }
}

class RosemaryPreviewPanel {
  private currentEditorLine: number | undefined;
  private currentCursorLine: number | undefined;
  private readonly foldedBlockLines = new Set<string>();
  private suppressEditorSyncUntil = 0;
  private readonly hoverDecoration: vscode.TextEditorDecorationType;
  private hoverDecorationTimer: ReturnType<typeof setTimeout> | undefined;
  private lastDiagnosticsSignature = "";

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private sourceDocument: vscode.TextDocument,
    private readonly onDispose: () => void,
  ) {
    this.hoverDecoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor("editor.wordHighlightBackground"),
      border: "1px solid",
      borderColor: new vscode.ThemeColor("editor.findMatchBorder"),
    });

    this.panel.webview.onDidReceiveMessage((message: unknown) => {
      if (isPreviewVisibleBlockMessage(message)) {
        void this.revealEditorLine(message.line);
        return;
      }

      if (isPreviewHoverBlockMessage(message)) {
        this.highlightEditorBlock(message.startLine, message.endLine);
        return;
      }

      if (isPreviewBlockFoldStateMessage(message)) {
        this.setFoldedBlockLine(message.sourcePath, message.startLine, message.collapsed);
        return;
      }

      if (isPreviewToggleBlockFoldMessage(message)) {
        this.setFoldedBlockLine(message.sourcePath, message.startLine, message.collapsed);
        void this.foldEditorBlock(
          message.sourcePath,
          message.startLine,
          message.collapsed,
        );
      }
    });

    this.panel.onDidDispose(() => {
      this.hoverDecoration.dispose();
      if (this.hoverDecorationTimer) {
        clearTimeout(this.hoverDecorationTimer);
      }
      this.onDispose();
    });
  }

  static open(
    extensionUri: vscode.Uri,
    document: vscode.TextDocument,
    onDispose: () => void,
  ): RosemaryPreviewPanel {
    const panel = vscode.window.createWebviewPanel(
      "rosemaryPreview",
      `ROSEMARY Preview: ${document.fileName.split(/[\\/]/).pop() ?? "Untitled"}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    const instance = new RosemaryPreviewPanel(
      panel,
      extensionUri,
      document,
      onDispose,
    );
    void instance.refresh();
    return instance;
  }

  refreshForPotentialProjectChange(document: vscode.TextDocument): void {
    if (!isRosemaryDocument(document)) {
      return;
    }

    if (document.uri.toString() === this.sourceDocument.uri.toString()) {
      this.sourceDocument = document;
    }

    void this.refresh();
  }

  refreshForPotentialProjectFile(uri: vscode.Uri): void {
    if (!uri.fsPath.toLowerCase().endsWith(".rsmr")) {
      return;
    }

    void this.refresh();
  }

  syncFromVisibleRanges(
    document: vscode.TextDocument,
    visibleRanges: readonly vscode.Range[],
  ): void {
    if (document.uri.toString() !== this.sourceDocument.uri.toString()) {
      return;
    }

    if (Date.now() < this.suppressEditorSyncUntil || visibleRanges.length === 0) {
      return;
    }

    void this.panel.webview.postMessage({
      type: "editorVisibleRanges",
      sourcePath: normalizeFilePath(document.fileName),
      ranges: visibleRanges.map((visibleRange) => ({
        startLine: visibleRange.start.line + 1,
        endLine: visibleRange.end.line + 1,
      })),
    });

    const range = visibleRanges[0];
    if (!range) {
      return;
    }

    const line = Math.floor((range.start.line + range.end.line) / 2) + 1;
    if (line === this.currentEditorLine) {
      return;
    }

    this.currentEditorLine = line;
    void this.panel.webview.postMessage({
      type: "revealLine",
      line,
    });
  }

  syncFromSelection(editor: vscode.TextEditor): void {
    if (editor.document.uri.toString() !== this.sourceDocument.uri.toString()) {
      return;
    }

    const line = editor.selection.active.line + 1;
    if (line === this.currentCursorLine) {
      return;
    }

    this.currentCursorLine = line;
    void this.panel.webview.postMessage({
      type: "highlightLine",
      line,
    });
  }

  async refresh(): Promise<void> {
    const project = await parseProjectForDocument(this.sourceDocument);
    const allDiagnostics = project.diagnostics;
    const graph = buildGraph(project.document);
    const nonce = createNonce();
    const diagnosticsSignature = createDiagnosticsSignature(allDiagnostics);

    if (diagnosticsSignature !== this.lastDiagnosticsSignature) {
      this.lastDiagnosticsSignature = diagnosticsSignature;
      logDiagnostics(this.sourceDocument, allDiagnostics);
    }

    this.panel.title = `ROSEMARY Preview: ${
      this.sourceDocument.fileName.split(/[\\/]/).pop() ?? "Untitled"
    }`;
    this.panel.webview.html = renderPreviewHtml({
      document: project.document,
      graph,
      nonce,
      cspSource: this.panel.webview.cspSource,
      extensionUri: this.extensionUri,
      sourcePath: normalizeFilePath(this.sourceDocument.fileName),
      initialFoldedBlocks: [...this.foldedBlockLines].map(decodeFoldedBlockKey),
      initialRevealLine: this.currentEditorLine,
      initialHighlightLine: this.currentCursorLine,
    });
  }

  dispose(): void {
    this.panel.dispose();
  }

  private async revealEditorLine(line: number): Promise<void> {
    if (!Number.isFinite(line)) {
      return;
    }

    const targetLine = clamp(
      Math.floor(line) - 1,
      0,
      Math.max(0, this.sourceDocument.lineCount - 1),
    );
    const range = new vscode.Range(targetLine, 0, targetLine, 0);
    const visibleEditor = vscode.window.visibleTextEditors.find(
      (editor) =>
        editor.document.uri.toString() === this.sourceDocument.uri.toString(),
    );

    if (!visibleEditor) {
      return;
    }

    this.suppressEditorSyncUntil = Date.now() + 500;
    visibleEditor.revealRange(
      range,
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    );
  }

  private highlightEditorBlock(startLine: number, endLine: number): void {
    const visibleEditor = vscode.window.visibleTextEditors.find(
      (editor) =>
        editor.document.uri.toString() === this.sourceDocument.uri.toString(),
    );

    if (!visibleEditor) {
      return;
    }

    const start = clamp(
      Math.floor(startLine) - 1,
      0,
      Math.max(0, this.sourceDocument.lineCount - 1),
    );
    const end = clamp(
      Math.floor(endLine) - 1,
      start,
      Math.max(0, this.sourceDocument.lineCount - 1),
    );
    const endCharacter = this.sourceDocument.lineAt(end).text.length;
    const range = new vscode.Range(start, 0, end, endCharacter);

    if (this.hoverDecorationTimer) {
      clearTimeout(this.hoverDecorationTimer);
    }

    visibleEditor.setDecorations(this.hoverDecoration, [range]);
    this.hoverDecorationTimer = setTimeout(() => {
      visibleEditor.setDecorations(this.hoverDecoration, []);
    }, 850);
  }

  private async foldEditorBlock(
    sourcePath: string,
    startLine: number,
    collapsed: boolean,
  ): Promise<void> {
    const normalizedSourcePath = normalizeFilePath(sourcePath);
    let editor = vscode.window.visibleTextEditors.find(
      (candidate) =>
        normalizeFilePath(candidate.document.fileName) === normalizedSourcePath,
    );

    if (!editor || !Number.isFinite(startLine)) {
      return;
    }

    const activeEditor = vscode.window.activeTextEditor;
    if (
      !activeEditor ||
      normalizeFilePath(activeEditor.document.fileName) !== normalizedSourcePath
    ) {
      editor = await vscode.window.showTextDocument(editor.document, {
        viewColumn: editor.viewColumn,
        preview: false,
        preserveFocus: false,
      });
    }

    const selectionLine = clamp(
      Math.floor(startLine) - 1,
      0,
      Math.max(0, editor.document.lineCount - 1),
    );
    const selection = new vscode.Selection(selectionLine, 0, selectionLine, 0);
    editor.selection = selection;

    await vscode.commands.executeCommand(collapsed ? "editor.fold" : "editor.unfold", {
      selectionLines: [selectionLine],
    });
  }

  private setFoldedBlockLine(
    sourcePath: string,
    startLine: number,
    collapsed: boolean,
  ): void {
    const key = encodeFoldedBlockKey(sourcePath, startLine);
    if (collapsed) {
      this.foldedBlockLines.add(key);
      return;
    }

    this.foldedBlockLines.delete(key);
  }
}

interface BlockReferenceHighlightConfig {
  enabled: boolean;
  excludedBlockNames: Set<string>;
  colors: Record<string, string>;
}

interface BlockReferenceTarget {
  name: string;
  type: string | undefined;
  color: string;
  sourcePath: string | undefined;
  range: RosemaryDiagnostic["range"];
  block: BlockNode;
}

interface BlockReferenceSearchRange {
  startOffset: number;
  endOffset: number;
}

interface BlockReferenceMatch {
  startOffset: number;
  endOffset: number;
  target: BlockReferenceTarget;
}

interface FoldedBlockState {
  sourcePath: string;
  startLine: number;
}

const DEFAULT_BLOCK_REFERENCE_HIGHLIGHT_COLORS: Record<string, string> = {
  default: "rgba(189, 147, 249, 0.22)",
  act: "rgba(203, 166, 247, 0.22)",
  chapter: "rgba(137, 180, 250, 0.22)",
  scene: "rgba(74, 144, 226, 0.24)",
  character: "rgba(80, 200, 120, 0.24)",
  item: "rgba(240, 190, 90, 0.24)",
  info: "rgba(160, 170, 185, 0.22)",
  relationship: "rgba(180, 120, 255, 0.24)",
  state: "rgba(130, 170, 150, 0.2)",
  unknown: "rgba(255, 120, 120, 0.2)",
};

const FIELD_BLOCK_OPEN_PATTERN =
  /^\s*(?:"(?:\\.|[^"\\])*"|[^\s:{}[\](),=@#?!"]+)\s*:\s*\[\s*$/;

class BlockReferenceHighlighter implements vscode.Disposable {
  private readonly refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly refreshVersions = new Map<string, number>();
  private readonly decorationTypes = new Map<string, vscode.TextEditorDecorationType>();
  private config = loadBlockReferenceHighlightConfig();

  scheduleRefresh(document: vscode.TextDocument, delay = 160): void {
    if (!isRosemaryDocument(document)) {
      this.clearDocument(document);
      return;
    }

    const key = document.uri.toString();
    const existingTimer = this.refreshTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.refreshTimers.delete(key);
      void this.refreshDocument(document);
    }, delay);
    this.refreshTimers.set(key, timer);
  }

  refreshVisibleEditors(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.scheduleRefresh(editor.document, 0);
    }
  }

  reloadConfiguration(): void {
    this.config = loadBlockReferenceHighlightConfig();
    this.disposeDecorationTypes();
    this.refreshVisibleEditors();
  }

  clearDocument(document: vscode.TextDocument): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() !== document.uri.toString()) {
        continue;
      }

      this.clearEditor(editor);
    }
  }

  dispose(): void {
    for (const timer of this.refreshTimers.values()) {
      clearTimeout(timer);
    }
    this.refreshTimers.clear();
    this.disposeDecorationTypes();
  }

  private async refreshDocument(document: vscode.TextDocument): Promise<void> {
    if (!isRosemaryDocument(document)) {
      this.clearDocument(document);
      return;
    }

    const key = document.uri.toString();
    const version = (this.refreshVersions.get(key) ?? 0) + 1;
    this.refreshVersions.set(key, version);

    if (!this.config.enabled) {
      this.clearDocument(document);
      return;
    }

    let project: RosemaryProject;
    try {
      project = await parseProjectForDocument(document);
    } catch (error) {
      console.error(`[ROSEMARY] Failed to refresh block reference highlights.`, error);
      this.clearDocument(document);
      return;
    }

    if (this.refreshVersions.get(key) !== version) {
      return;
    }

    const buckets = buildBlockReferenceDecorationBuckets(
      document,
      project,
      this.config,
    );

    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() !== key) {
        continue;
      }

      this.applyDecorations(editor, buckets);
    }
  }

  private applyDecorations(
    editor: vscode.TextEditor,
    buckets: Map<string, vscode.DecorationOptions[]>,
  ): void {
    this.clearEditor(editor);

    for (const [color, options] of buckets) {
      editor.setDecorations(this.getDecorationType(color), options);
    }
  }

  private clearEditor(editor: vscode.TextEditor): void {
    for (const decorationType of this.decorationTypes.values()) {
      editor.setDecorations(decorationType, []);
    }
  }

  private getDecorationType(color: string): vscode.TextEditorDecorationType {
    const existing = this.decorationTypes.get(color);
    if (existing) {
      return existing;
    }

    const decorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: color,
      borderRadius: "2px",
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
    this.decorationTypes.set(color, decorationType);
    return decorationType;
  }

  private disposeDecorationTypes(): void {
    for (const decorationType of this.decorationTypes.values()) {
      decorationType.dispose();
    }
    this.decorationTypes.clear();
  }
}

interface PreviewData {
  document: RosemaryDocument;
  graph: GraphModel;
  nonce: string;
  cspSource: string;
  extensionUri: vscode.Uri;
  sourcePath: string;
  initialFoldedBlocks: FoldedBlockState[];
  initialRevealLine?: number;
  initialHighlightLine?: number;
}

function shouldRenderGraph(document: RosemaryDocument): boolean {
  const graphField = document.meta?.fields.find((field) => field.name === "graph");
  if (!graphField) {
    return true;
  }

  if (graphField.value.kind === "boolean") {
    return graphField.value.value;
  }

  return true;
}

function renderPreviewHtml(data: PreviewData): string {
  const meta = renderMeta(data.document.meta);
  const blocks = data.document.blocks.map(renderBlock).join("");
  const graphJson = escapeJsonForScript(data.graph);
  const sourcePathJson = escapeJsonForScript(data.sourcePath);
  const foldedBlocksJson = escapeJsonForScript(data.initialFoldedBlocks);
  const graphSection = shouldRenderGraph(data.document)
    ? `<section>
      <div class="section-head">
        <h2>Graph</h2>
        <div class="graph-toolbar" aria-label="Graph controls">
          <button class="graph-button" id="zoom-in" type="button" title="Zoom in">+</button>
          <button class="graph-button" id="zoom-out" type="button" title="Zoom out">-</button>
          <button class="graph-button" id="zoom-reset" type="button" title="Reset view">Reset</button>
        </div>
      </div>
      <div class="section-body">
        <div id="graph" aria-label="ROSEMARY graph preview"></div>
      </div>
    </section>`
    : "";

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${data.cspSource} https:; style-src 'unsafe-inline' ${data.cspSource}; script-src 'nonce-${data.nonce}';"
  >
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ROSEMARY Preview</title>
  <style>
    :root {
      color-scheme: light dark;
      --panel-border: color-mix(in srgb, var(--vscode-editor-foreground) 18%, transparent);
      --panel-muted: color-mix(in srgb, var(--vscode-editor-foreground) 68%, transparent);
      --node-scene: color-mix(in srgb, var(--vscode-charts-blue) 24%, transparent);
      --node-character: color-mix(in srgb, var(--vscode-charts-green) 28%, transparent);
      --node-relationship: color-mix(in srgb, var(--vscode-charts-purple) 26%, transparent);
      --node-default: color-mix(in srgb, var(--vscode-editor-foreground) 8%, transparent);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 0;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    header {
      position: sticky;
      top: 0;
      z-index: 3;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      min-height: 48px;
      padding: 10px 18px;
      border-bottom: 1px solid var(--panel-border);
      background: var(--vscode-editor-background);
    }

    h1, h2, h3 {
      margin: 0;
      line-height: 1.25;
      font-weight: 650;
      letter-spacing: 0;
    }

    h1 {
      font-size: 16px;
    }

    h2 {
      font-size: 14px;
      margin-bottom: 10px;
    }

    h3 {
      font-size: 13px;
    }

    .stats {
      display: flex;
      align-items: center;
      gap: 12px;
      color: var(--panel-muted);
      font-size: 12px;
      white-space: nowrap;
    }

    main {
      display: grid;
      gap: 16px;
      padding: 16px;
    }

    section {
      min-width: 0;
      border: 1px solid var(--panel-border);
      border-radius: 6px;
      background: color-mix(in srgb, var(--vscode-editor-background) 94%, var(--vscode-editor-foreground) 6%);
    }

    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--panel-border);
    }

    .section-body {
      padding: 14px;
    }

    .graph-toolbar {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .graph-button {
      min-width: 30px;
      min-height: 26px;
      padding: 2px 8px;
      border: 1px solid var(--panel-border);
      border-radius: 4px;
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
      font: inherit;
      font-size: 12px;
      line-height: 1;
      cursor: pointer;
    }

    .graph-button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    #graph {
      width: 100%;
      min-height: 520px;
      overflow: hidden;
      cursor: grab;
      user-select: none;
    }

    #graph.panning {
      cursor: grabbing;
    }

    svg {
      display: block;
      width: 100%;
      height: 520px;
    }

    .block-tree {
      display: grid;
      gap: 10px;
    }

    .block {
      border: 1px solid var(--panel-border);
      border-radius: 6px;
      padding: 10px;
      background: var(--node-default);
      scroll-margin-top: 72px;
    }

    .block.cursor-synced {
      box-shadow: 0 0 0 2px var(--vscode-focusBorder), 0 0 0 5px color-mix(in srgb, var(--vscode-focusBorder) 24%, transparent);
    }

    .block.preview-hover {
      outline: 2px solid color-mix(in srgb, var(--vscode-editor-foreground) 72%, transparent);
      outline-offset: 2px;
    }

    .block.collapsed > .block-meta,
    .block.collapsed > .entries,
    .block.collapsed > .block-children {
      display: none;
    }

    .block.character {
      background: var(--node-character);
    }

    .block.scene {
      background: var(--node-scene);
    }

    .block.relationship {
      background: var(--node-relationship);
    }

    .block.state {
      background: color-mix(in srgb, var(--vscode-editor-background) 86%, var(--vscode-editor-foreground) 14%);
      border-style: dashed;
    }

    .block-children {
      display: grid;
      gap: 8px;
      margin-top: 10px;
      padding-left: 12px;
      border-left: 2px solid var(--panel-border);
    }

    .block-children.timeline {
      gap: 10px;
      padding-left: 20px;
      border-left-color: color-mix(in srgb, var(--vscode-charts-green) 48%, var(--panel-border));
    }

    .block-children.timeline > .block.state {
      position: relative;
    }

    .block-children.timeline > .block.state::before {
      content: "";
      position: absolute;
      top: 20px;
      left: -27px;
      width: 10px;
      height: 10px;
      border: 2px solid color-mix(in srgb, var(--vscode-charts-green) 64%, var(--vscode-editor-foreground));
      border-radius: 50%;
      background: var(--vscode-editor-background);
    }

    .block-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .block-title-main {
      display: flex;
      align-items: center;
      min-width: 0;
      gap: 7px;
    }

    .block-toggle {
      flex: 0 0 auto;
      width: 22px;
      height: 22px;
      display: inline-grid;
      place-items: center;
      border: 1px solid var(--panel-border);
      border-radius: 4px;
      color: var(--panel-muted);
      background: transparent;
      font: inherit;
      line-height: 1;
      cursor: pointer;
    }

    .block-toggle:hover {
      color: var(--vscode-editor-foreground);
      background: color-mix(in srgb, var(--vscode-editor-foreground) 10%, transparent);
    }

    .block-toggle::before {
      content: "▾";
      font-size: 12px;
    }

    .block.collapsed > .block-title .block-toggle::before {
      content: "▸";
    }

    .block-kind {
      flex: 0 0 auto;
      color: var(--panel-muted);
      font-size: 11px;
    }

    .block-meta {
      display: grid;
      gap: 7px;
      margin-top: 8px;
    }

    .attribute-cluster {
      display: grid;
      gap: 4px;
    }

    .attribute-row,
    .attribute-detail-row,
    .tag-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }

    .attribute-detail-row {
      margin-left: 10px;
      padding-left: 10px;
      border-left: 2px solid color-mix(in srgb, var(--vscode-charts-blue) 42%, var(--panel-border));
    }

    .tag-row {
      padding-top: 6px;
      border-top: 1px dashed color-mix(in srgb, var(--vscode-editor-foreground) 24%, transparent);
    }

    .attribute-badge,
    .key-value-badge,
    .tag-badge {
      display: inline-flex;
      align-items: center;
      min-height: 20px;
      padding: 2px 7px;
      border: 1px solid var(--panel-border);
      font-size: 11px;
      line-height: 1.2;
    }

    .attribute-badge {
      border-radius: 999px;
      color: var(--vscode-editor-foreground);
      background: color-mix(in srgb, var(--vscode-charts-blue) 20%, transparent);
    }

    .key-value-badge {
      gap: 3px;
      border-radius: 4px;
      color: var(--panel-muted);
      background: color-mix(in srgb, var(--vscode-editor-background) 76%, var(--vscode-charts-blue) 24%);
    }

    .key-value-key {
      color: var(--vscode-editor-foreground);
      font-weight: 600;
    }

    .key-value-separator {
      color: var(--panel-muted);
    }

    .tag-badge {
      border-style: dashed;
      border-radius: 999px;
      color: color-mix(in srgb, var(--vscode-charts-yellow) 78%, var(--vscode-editor-foreground));
      background: color-mix(in srgb, var(--vscode-charts-yellow) 14%, transparent);
    }

    .entries {
      display: grid;
      gap: 5px;
      margin-top: 9px;
      color: var(--panel-muted);
      font-size: 12px;
    }

    .entry {
      overflow-wrap: anywhere;
    }

    .entry strong {
      color: var(--vscode-editor-foreground);
      font-weight: 600;
    }

    .annotation-entry {
      color: var(--panel-muted);
      font-style: italic;
    }

    .inline-annotation {
      color: var(--panel-muted);
      font-size: 0.95em;
    }

    .list-item-annotation {
      display: block;
      margin-top: 2px;
      color: var(--panel-muted);
      font-size: 0.95em;
      font-style: italic;
    }

    .dialogue-entry {
      display: grid;
      gap: 3px;
      margin: 2px 0;
      padding: 6px 10px;
      border-left: 3px solid color-mix(in srgb, var(--vscode-charts-blue) 68%, var(--vscode-editor-foreground));
      border-radius: 0 4px 4px 0;
      color: var(--vscode-editor-foreground);
      background: color-mix(in srgb, var(--vscode-charts-blue) 10%, transparent);
    }

    .dialogue-row {
      display: grid;
      grid-template-columns: max-content max-content minmax(0, 1fr);
      align-items: baseline;
      gap: 4px;
    }

    .dialogue-speaker {
      color: var(--panel-muted);
      font-size: 12px;
      font-weight: 650;
      white-space: nowrap;
    }

    .dialogue-separator {
      color: var(--panel-muted);
    }

    .dialogue-text {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .multiline-field {
      margin: 4px 0 0;
      white-space: pre-wrap;
    }

    .rich-field {
      display: grid;
      gap: 4px;
      margin-top: 4px;
    }

    .field-list {
      margin: 4px 0 0;
      padding-left: 20px;
    }

    .field-list li {
      margin: 2px 0;
    }

    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 8px;
    }

    .meta-item {
      display: grid;
      grid-template-columns: 96px minmax(0, 1fr);
      gap: 8px;
      font-size: 12px;
    }

    .meta-key {
      color: var(--panel-muted);
    }

    .empty {
      color: var(--panel-muted);
      font-size: 12px;
    }

    @media (max-width: 860px) {
      header {
        align-items: flex-start;
        flex-direction: column;
      }

      .stats {
        flex-wrap: wrap;
      }
    }
  </style>
</head>
<body>
  <header>
    <h1>ROSEMARY Preview</h1>
    <div class="stats">
      <span>${data.graph.nodes.length} blocks</span>
      <span>${data.graph.edges.length} links</span>
    </div>
  </header>
  <main>
    <section>
      <div class="section-head">
        <h2>Meta</h2>
      </div>
      <div class="section-body">
        ${meta}
      </div>
    </section>
    ${graphSection}
    <section>
      <div class="section-head">
        <h2>Blocks</h2>
      </div>
      <div class="section-body block-tree">
        ${blocks || '<div class="empty">No blocks found.</div>'}
      </div>
    </section>
  </main>
  <script nonce="${data.nonce}">
    const vscodeApi = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;
    const graph = ${graphJson};
    const sourcePath = ${sourcePathJson};
    const initialFoldedBlocks = ${foldedBlocksJson};
    const initialRevealLine = ${data.initialRevealLine ?? "null"};
    const initialHighlightLine = ${data.initialHighlightLine ?? "null"};
    const container = document.getElementById("graph");
    const zoomInButton = document.getElementById("zoom-in");
    const zoomOutButton = document.getElementById("zoom-out");
    const zoomResetButton = document.getElementById("zoom-reset");
    const nodeWidth = 150;
    const nodeHeight = 48;
    const padding = 34;
    let activeSvg = null;
    let defaultViewBox = null;
    let currentViewBox = null;
    let panStart = null;
    let suppressPreviewSyncUntil = 0;
    let lastPreviewLine = null;
    const collapsedBlockKeys = new Set(
      initialFoldedBlocks.map((block) => block.sourcePath + ":" + block.startLine)
    );

    function nodeColor(node) {
      if (node.type === "character") return "var(--vscode-charts-green)";
      if (node.type === "scene") return "var(--vscode-charts-blue)";
      if (node.type === "relationship") return "var(--vscode-charts-purple)";
      return "var(--vscode-editor-foreground)";
    }

    function rectFor(point) {
      return {
        x: point.x,
        y: point.y,
        width: nodeWidth,
        height: nodeHeight,
        centerX: point.x + nodeWidth / 2,
        centerY: point.y + nodeHeight / 2
      };
    }

    function boundaryPoint(fromRect, toRect) {
      const dx = toRect.centerX - fromRect.centerX;
      const dy = toRect.centerY - fromRect.centerY;
      if (dx === 0 && dy === 0) {
        return { x: fromRect.centerX, y: fromRect.centerY };
      }

      const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : (fromRect.width / 2) / Math.abs(dx);
      const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : (fromRect.height / 2) / Math.abs(dy);
      const scale = Math.min(scaleX, scaleY);
      return {
        x: fromRect.centerX + dx * scale,
        y: fromRect.centerY + dy * scale
      };
    }

    function typeRank(node) {
      const ranks = {
        act: 0,
        chapter: 1,
        scene: 2,
        character: 3,
        item: 4,
        info: 5,
        unknown: 6,
        relationship: 7
      };
      return ranks[node.type] ?? 8;
    }

    function computeLayout() {
      const incoming = new Map();
      const outgoing = new Map();
      graph.nodes.forEach((node) => {
        incoming.set(node.id, 0);
        outgoing.set(node.id, []);
      });

      graph.edges.forEach((edge) => {
        if (!incoming.has(edge.source) || !incoming.has(edge.target)) return;
        incoming.set(edge.target, incoming.get(edge.target) + 1);
        outgoing.get(edge.source).push(edge.target);
      });

      const depth = new Map();
      const queue = graph.nodes
        .filter((node) => incoming.get(node.id) === 0)
        .sort((a, b) => typeRank(a) - typeRank(b) || a.name.localeCompare(b.name));

      if (!queue.length && graph.nodes.length) {
        queue.push(graph.nodes[0]);
      }

      queue.forEach((node) => depth.set(node.id, 0));

      for (let index = 0; index < queue.length; index += 1) {
        const node = queue[index];
        const nextDepth = (depth.get(node.id) ?? 0) + 1;
        for (const target of outgoing.get(node.id) ?? []) {
          if ((depth.get(target) ?? -1) < nextDepth) {
            depth.set(target, nextDepth);
            const targetNode = graph.nodes.find((candidate) => candidate.id === target);
            if (targetNode && nextDepth <= graph.nodes.length) {
              queue.push(targetNode);
            }
          }
        }
      }

      graph.nodes.forEach((node) => {
        if (!depth.has(node.id)) {
          depth.set(node.id, Math.max(0, typeRank(node) - 1));
        }
      });

      const layers = new Map();
      graph.nodes.forEach((node) => {
        const layer = depth.get(node.id) ?? 0;
        if (!layers.has(layer)) {
          layers.set(layer, []);
        }
        layers.get(layer).push(node);
      });

      const sortedLayers = [...layers.entries()].sort((a, b) => a[0] - b[0]);
      sortedLayers.forEach(([, nodes]) => {
        nodes.sort((a, b) => typeRank(a) - typeRank(b) || a.name.localeCompare(b.name));
      });

      const columnGap = 230;
      const rowGap = 126;
      const maxRows = Math.max(...sortedLayers.map(([, nodes]) => nodes.length), 1);
      const width = Math.max(520, sortedLayers.length * columnGap + padding * 2);
      const height = Math.max(420, maxRows * rowGap + padding * 2);
      const positions = new Map();

      sortedLayers.forEach(([layer, nodes]) => {
        const layerHeight = (nodes.length - 1) * rowGap;
        const startY = padding + Math.max(0, (height - padding * 2 - layerHeight - nodeHeight) / 2);
        nodes.forEach((node, row) => {
          positions.set(node.id, {
            x: padding + layer * columnGap,
            y: startY + row * rowGap
          });
        });
      });

      return { positions, width, height };
    }

    function setViewBox(viewBox) {
      currentViewBox = {
        x: viewBox.x,
        y: viewBox.y,
        width: viewBox.width,
        height: viewBox.height
      };
      if (activeSvg) {
        activeSvg.setAttribute(
          "viewBox",
          currentViewBox.x + " " + currentViewBox.y + " " + currentViewBox.width + " " + currentViewBox.height
        );
      }
    }

    function zoomAt(clientX, clientY, factor) {
      if (!activeSvg || !currentViewBox) return;
      const rect = activeSvg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const svgX = currentViewBox.x + ((clientX - rect.left) / rect.width) * currentViewBox.width;
      const svgY = currentViewBox.y + ((clientY - rect.top) / rect.height) * currentViewBox.height;
      const nextWidth = clamp(currentViewBox.width * factor, defaultViewBox.width * 0.2, defaultViewBox.width * 5);
      const nextHeight = clamp(currentViewBox.height * factor, defaultViewBox.height * 0.2, defaultViewBox.height * 5);
      const ratioX = (svgX - currentViewBox.x) / currentViewBox.width;
      const ratioY = (svgY - currentViewBox.y) / currentViewBox.height;

      setViewBox({
        x: svgX - ratioX * nextWidth,
        y: svgY - ratioY * nextHeight,
        width: nextWidth,
        height: nextHeight
      });
    }

    function zoomFromCenter(factor) {
      if (!activeSvg) return;
      const rect = activeSvg.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    }

    function resetView() {
      if (!defaultViewBox) return;
      setViewBox(defaultViewBox);
    }

    function clientDeltaToSvgDelta(deltaX, deltaY) {
      if (!activeSvg || !currentViewBox) return { x: 0, y: 0 };
      const rect = activeSvg.getBoundingClientRect();
      return {
        x: (deltaX / rect.width) * currentViewBox.width,
        y: (deltaY / rect.height) * currentViewBox.height
      };
    }

    function attachGraphInteractions(svg, width, height) {
      activeSvg = svg;
      defaultViewBox = { x: 0, y: 0, width, height };
      setViewBox(defaultViewBox);

      svg.addEventListener("wheel", (event) => {
        event.preventDefault();
        zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 0.9 : 1.1);
      }, { passive: false });

      svg.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        panStart = {
          x: event.clientX,
          y: event.clientY,
          viewBox: { ...currentViewBox }
        };
        container.classList.add("panning");
        svg.setPointerCapture(event.pointerId);
      });

      svg.addEventListener("pointermove", (event) => {
        if (!panStart) return;
        const delta = clientDeltaToSvgDelta(event.clientX - panStart.x, event.clientY - panStart.y);
        setViewBox({
          x: panStart.viewBox.x - delta.x,
          y: panStart.viewBox.y - delta.y,
          width: panStart.viewBox.width,
          height: panStart.viewBox.height
        });
      });

      svg.addEventListener("pointerup", (event) => {
        panStart = null;
        container.classList.remove("panning");
        if (svg.hasPointerCapture(event.pointerId)) {
          svg.releasePointerCapture(event.pointerId);
        }
      });

      svg.addEventListener("pointercancel", () => {
        panStart = null;
        container.classList.remove("panning");
      });

      svg.addEventListener("dblclick", () => {
        resetView();
      });
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function blockElements() {
      return [...document.querySelectorAll(".block[data-start-line][data-end-line]")];
    }

    function lineRangeOf(block) {
      return {
        start: Number(block.dataset.startLine),
        end: Number(block.dataset.endLine)
      };
    }

    function sourceOf(block) {
      return block.dataset.sourcePath || sourcePath;
    }

    function blockKey(block) {
      return sourceOf(block) + ":" + lineRangeOf(block).start;
    }

    function isEntrySourceBlock(block) {
      return sourceOf(block) === sourcePath;
    }

    function entrySourceBlockElements() {
      return blockElements().filter(isEntrySourceBlock);
    }

    function setBlockCollapsed(block, collapsed, notify) {
      const range = lineRangeOf(block);
      const key = blockKey(block);
      block.classList.toggle("collapsed", collapsed);
      block.querySelector(":scope > .block-title .block-toggle")?.setAttribute(
        "aria-expanded",
        String(!collapsed)
      );

      if (collapsed) {
        collapsedBlockKeys.add(key);
      } else {
        collapsedBlockKeys.delete(key);
      }

      if (notify && vscodeApi) {
        vscodeApi.postMessage({
          type: "previewBlockFoldState",
          sourcePath: sourceOf(block),
          startLine: range.start,
          collapsed
        });
      }
    }

    function isLineVisible(line, ranges) {
      return ranges.some((range) => range.startLine <= line && line <= range.endLine);
    }

    function applyEditorVisibleRanges(message) {
      if (!message?.sourcePath || !Array.isArray(message.ranges)) {
        return;
      }

      const maxVisibleLine = Math.max(...message.ranges.map((range) => range.endLine));
      blockElements()
        .filter((block) => sourceOf(block) === message.sourcePath)
        .forEach((block) => {
          const range = lineRangeOf(block);
          if (
            range.end <= range.start ||
            range.start + 1 > maxVisibleLine ||
            !isLineVisible(range.start, message.ranges)
          ) {
            return;
          }

          const collapsed = !isLineVisible(range.start + 1, message.ranges);
          setBlockCollapsed(block, collapsed, true);
        });
    }

    function applyInitialFoldedBlocks() {
      blockElements().forEach((block) => {
        const shouldCollapse =
          !isEntrySourceBlock(block) || collapsedBlockKeys.has(blockKey(block));
        setBlockCollapsed(block, shouldCollapse, false);
      });
    }

    function blockForLine(line) {
      const blocks = entrySourceBlockElements();
      const containing = blocks
        .filter((block) => {
          const range = lineRangeOf(block);
          return range.start <= line && line <= range.end;
        })
        .sort((a, b) => {
          const aRange = lineRangeOf(a);
          const bRange = lineRangeOf(b);
          return (aRange.end - aRange.start) - (bRange.end - bRange.start);
        });

      if (containing[0]) {
        return containing[0];
      }

      return blocks
        .map((block) => {
          const range = lineRangeOf(block);
          return {
            block,
            distance: Math.min(Math.abs(range.start - line), Math.abs(range.end - line))
          };
        })
        .sort((a, b) => a.distance - b.distance)[0]?.block ?? null;
    }

    function revealLineInPreview(line) {
      const block = blockForLine(Number(line));
      if (!block) return;

      suppressPreviewSyncUntil = Date.now() + 700;
      block.scrollIntoView({
        block: "center",
        behavior: "smooth"
      });
    }

    function highlightLineInPreview(line) {
      const block = blockForLine(Number(line));
      if (!block) return;

      document.querySelectorAll(".block.cursor-synced").forEach((element) => {
        element.classList.remove("cursor-synced");
      });
      block.classList.add("cursor-synced");
    }

    function bindPreviewBlockHover() {
      blockElements().forEach((block) => {
        block.addEventListener("pointerenter", () => {
          document.querySelectorAll(".block.preview-hover").forEach((element) => {
            element.classList.remove("preview-hover");
          });
          block.classList.add("preview-hover");

          if (!vscodeApi || !isEntrySourceBlock(block)) return;
          const range = lineRangeOf(block);
          vscodeApi.postMessage({
            type: "previewHoverBlock",
            startLine: range.start,
            endLine: range.end
          });
        });

        block.addEventListener("pointerleave", () => {
          block.classList.remove("preview-hover");
        });
      });
    }

    function bindPreviewBlockFoldToggles() {
      blockElements().forEach((block) => {
        const toggle = block.querySelector(":scope > .block-title .block-toggle");
        if (!toggle) return;

        toggle.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const collapsed = !block.classList.contains("collapsed");
          setBlockCollapsed(block, collapsed, true);

          if (!vscodeApi) return;
          const range = lineRangeOf(block);
          vscodeApi.postMessage({
            type: "previewToggleBlockFold",
            sourcePath: sourceOf(block),
            startLine: range.start,
            collapsed
          });
        });
      });
    }

    function notifyVisiblePreviewBlock() {
      if (!vscodeApi || Date.now() < suppressPreviewSyncUntil) {
        return;
      }

      const targetY = window.innerHeight * 0.35;
      const block = entrySourceBlockElements()
        .map((element) => ({
          element,
          distance: Math.abs(element.getBoundingClientRect().top - targetY)
        }))
        .sort((a, b) => a.distance - b.distance)[0]?.element;

      if (!block) {
        return;
      }

      const line = Number(block.dataset.startLine);
      if (!Number.isFinite(line) || line === lastPreviewLine) {
        return;
      }

      lastPreviewLine = line;
      vscodeApi.postMessage({
        type: "previewVisibleBlock",
        line
      });
    }

    function throttle(callback, delay) {
      let pending = false;
      return () => {
        if (pending) return;
        pending = true;
        window.setTimeout(() => {
          pending = false;
          callback();
        }, delay);
      };
    }

    function drawGraph() {
      if (!container) {
        return;
      }

      container.textContent = "";
      if (!graph.nodes.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "No graph nodes found.";
        container.appendChild(empty);
        return;
      }

      const { positions, width, height } = computeLayout();

      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("role", "img");

      const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
      marker.setAttribute("id", "arrow");
      marker.setAttribute("markerWidth", "10");
      marker.setAttribute("markerHeight", "10");
      marker.setAttribute("refX", "8");
      marker.setAttribute("refY", "3");
      marker.setAttribute("orient", "auto-start-reverse");
      marker.setAttribute("markerUnits", "strokeWidth");
      const arrowPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      arrowPath.setAttribute("d", "M0,0 L0,6 L9,3 z");
      arrowPath.setAttribute("fill", "currentColor");
      marker.appendChild(arrowPath);
      defs.appendChild(marker);
      svg.appendChild(defs);

      graph.edges.forEach((edge) => {
        const from = positions.get(edge.source);
        const to = positions.get(edge.target);
        if (!from || !to) return;
        const fromRect = rectFor(from);
        const toRect = rectFor(to);
        const start = boundaryPoint(fromRect, toRect);
        const end = boundaryPoint(toRect, fromRect);

        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", String(start.x));
        line.setAttribute("y1", String(start.y));
        line.setAttribute("x2", String(end.x));
        line.setAttribute("y2", String(end.y));
        line.setAttribute("stroke", "currentColor");
        line.setAttribute("stroke-width", edge.style === "bold" ? "3" : "1.5");
        line.setAttribute("opacity", "0.72");
        line.setAttribute("marker-end", "url(#arrow)");
        if (edge.direction === "bidirectional") {
          line.setAttribute("marker-start", "url(#arrow)");
        }
        if (edge.style === "dotted") {
          line.setAttribute("stroke-dasharray", "5 5");
        }
        svg.appendChild(line);

        if (edge.label) {
          const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
          text.setAttribute("x", String((start.x + end.x) / 2));
          text.setAttribute("y", String((start.y + end.y) / 2 - 8));
          text.setAttribute("fill", "currentColor");
          text.setAttribute("font-size", "11");
          text.setAttribute("text-anchor", "middle");
          text.textContent = edge.label;
          svg.appendChild(text);
        }
      });

      graph.nodes.forEach((node) => {
        const point = positions.get(node.id);
        if (!point) return;

        const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", String(point.x));
        rect.setAttribute("y", String(point.y));
        rect.setAttribute("width", String(nodeWidth));
        rect.setAttribute("height", String(nodeHeight));
        rect.setAttribute("rx", "6");
        rect.setAttribute("fill", nodeColor(node));
        rect.setAttribute("fill-opacity", "0.18");
        rect.setAttribute("stroke", nodeColor(node));
        rect.setAttribute("stroke-opacity", "0.85");
        group.appendChild(rect);

        const title = document.createElementNS("http://www.w3.org/2000/svg", "text");
        title.setAttribute("x", String(point.x + 12));
        title.setAttribute("y", String(point.y + 21));
        title.setAttribute("fill", "currentColor");
        title.setAttribute("font-size", "12");
        title.setAttribute("font-weight", "650");
        title.textContent = node.name.length > 16 ? node.name.slice(0, 15) + "..." : node.name;
        group.appendChild(title);

        const kind = document.createElementNS("http://www.w3.org/2000/svg", "text");
        kind.setAttribute("x", String(point.x + 12));
        kind.setAttribute("y", String(point.y + 38));
        kind.setAttribute("fill", "currentColor");
        kind.setAttribute("font-size", "10");
        kind.setAttribute("opacity", "0.72");
        kind.textContent = node.type || "block";
        group.appendChild(kind);

        svg.appendChild(group);
      });

      container.appendChild(svg);
      attachGraphInteractions(svg, width, height);
    }

    zoomInButton?.addEventListener("click", () => zoomFromCenter(0.82));
    zoomOutButton?.addEventListener("click", () => zoomFromCenter(1.22));
    zoomResetButton?.addEventListener("click", resetView);
    window.addEventListener("message", (event) => {
      if (event.data?.type === "revealLine") {
        revealLineInPreview(event.data.line);
        return;
      }

      if (event.data?.type === "highlightLine") {
        highlightLineInPreview(event.data.line);
        return;
      }

      if (event.data?.type === "editorVisibleRanges") {
        applyEditorVisibleRanges(event.data);
      }
    });
    window.addEventListener("scroll", throttle(notifyVisiblePreviewBlock, 160), {
      passive: true
    });

    drawGraph();
    bindPreviewBlockHover();
    bindPreviewBlockFoldToggles();
    applyInitialFoldedBlocks();
    if (initialRevealLine !== null) {
      window.requestAnimationFrame(() => revealLineInPreview(initialRevealLine));
    }
    if (initialHighlightLine !== null) {
      window.requestAnimationFrame(() => highlightLineInPreview(initialHighlightLine));
    }
  </script>
</body>
</html>`;
}

function renderMeta(meta: MetaBlock | undefined): string {
  if (!meta?.fields.length) {
    return '<div class="empty">No meta information.</div>';
  }

  return `<div class="meta-grid">${meta.fields
    .map(
      (field) => `<div class="meta-item">
        <span class="meta-key">${escapeHtml(field.name)}</span>
        <span>${renderFieldValue(field.value)}</span>
      </div>`,
    )
    .join("")}</div>`;
}

function renderBlock(block: BlockNode): string {
  const type = blockType(block);
  const childBlocks = block.entries.filter(
    (entry): entry is BlockNode => entry.kind === "block",
  );
  const children = childBlocks.map(renderBlock).join("");
  const childClass =
    childBlocks.length > 0 && childBlocks.every((child) => blockType(child) === "state")
      ? "block-children timeline"
      : "block-children";
  const entries = renderEntries(
    block.entries.filter((entry): entry is Exclude<BlockEntry, BlockNode> => entry.kind !== "block"),
  );
  const meta = renderBlockMeta(block);

  return `<article class="block ${escapeHtml(type ?? "")}" data-start-line="${
    block.range.start.line
  }" data-end-line="${block.range.end.line}" data-source-path="${escapeHtml(
    block.source?.path ?? "",
  )}">
    <div class="block-title">
      <div class="block-title-main">
        <button class="block-toggle" type="button" aria-label="Toggle block" aria-expanded="true"></button>
        <h3>${escapeHtml(block.name)}</h3>
      </div>
      <span class="block-kind">${escapeHtml(
        [type ?? "block", block.source?.path ? sourceLabel(block.source.path) : ""]
          .filter(Boolean)
          .join(" · "),
      )}</span>
    </div>
    ${meta}
    ${entries ? `<div class="entries">${entries}</div>` : ""}
    ${children ? `<div class="${childClass}">${children}</div>` : ""}
  </article>`;
}

function renderBlockMeta(block: BlockNode): string {
  const attributes = block.attributes.filter((attribute) => attribute.value === undefined);
  const keyValueAttributes = block.attributes.filter(
    (attribute) => attribute.value !== undefined,
  );

  const attributeRow = attributes
    .map(
      (attribute) =>
        `<span class="attribute-badge">${escapeHtml(attribute.name)}</span>`,
    )
    .join("");
  const keyValueRow = keyValueAttributes
    .map((attribute) => {
      const value = attribute.value ? formatValue(attribute.value) : "";
      return `<span class="key-value-badge"><span class="key-value-key">${escapeHtml(
        attribute.name,
      )}</span><span class="key-value-separator">=</span><span>${escapeHtml(
        value,
      )}</span></span>`;
    })
    .join("");
  const tagRow = block.tags
    .map((tag) => `<span class="tag-badge">#${escapeHtml(tag.name)}</span>`)
    .join("");

  if (!attributeRow && !keyValueRow && !tagRow) {
    return "";
  }

  return `<div class="block-meta">
    ${
      attributeRow || keyValueRow
        ? `<div class="attribute-cluster">
            ${attributeRow ? `<div class="attribute-row">${attributeRow}</div>` : ""}
            ${keyValueRow ? `<div class="attribute-detail-row">${keyValueRow}</div>` : ""}
          </div>`
        : ""
    }
    ${tagRow ? `<div class="tag-row">${tagRow}</div>` : ""}
  </div>`;
}

function blockType(block: BlockNode): string | undefined {
  return block.attributes.find((attribute) => attribute.value === undefined)?.name;
}

function renderEntries(entries: readonly Exclude<BlockEntry, BlockNode>[]): string {
  const rendered: string[] = [];
  let dialogueGroup: DialogueEntry[] = [];

  const flushDialogueGroup = (): void => {
    if (!dialogueGroup.length) {
      return;
    }

    rendered.push(renderDialogueGroup(dialogueGroup));
    dialogueGroup = [];
  };

  for (const entry of entries) {
    if (entry.kind === "dialogue") {
      dialogueGroup.push(entry);
      continue;
    }

    flushDialogueGroup();
    const renderedEntry = renderEntry(entry);
    if (renderedEntry) {
      rendered.push(renderedEntry);
    }
  }

  flushDialogueGroup();
  return rendered.join("");
}

function renderEntry(entry: Exclude<BlockEntry, BlockNode>): string {
  switch (entry.kind) {
    case "text":
      return `<div class="entry">${escapeHtml(entry.value)}</div>`;
    case "field":
      return `<div class="entry"><strong>${escapeHtml(entry.name)}:</strong> ${renderFieldValue(
        entry.value,
      )}</div>`;
    case "dialogue":
      return renderDialogueGroup([entry]);
    case "link":
      return renderLink(entry);
    case "question":
      return `<div class="entry"><strong>?</strong> ${escapeHtml(entry.value)}</div>`;
    case "answer":
      return `<div class="entry"><strong>!</strong> ${escapeHtml(entry.value)}</div>`;
    case "annotation":
      return `<div class="entry annotation-entry"><strong>^</strong> <em>${escapeHtml(
        entry.value,
      )}</em></div>`;
  }
}

function renderDialogueGroup(
  entries: readonly { speaker: string; text: string; annotation?: string }[],
): string {
  const rows = entries
    .map(
      (entry) => `<div class="dialogue-row">
        <span class="dialogue-speaker">${escapeHtml(entry.speaker)}</span>
        <span class="dialogue-separator">:</span>
        <span class="dialogue-text">${escapeHtml(entry.text)}${renderInlineAnnotation(
          entry.annotation,
        )}</span>
      </div>`,
    )
    .join("");

  return `<blockquote class="entry dialogue-entry">${rows}</blockquote>`;
}

function renderLink(link: LinkEntry): string {
  const label = link.line?.label ? ` ${link.line.label}` : "";
  const direction = link.line?.direction === "bidirectional" ? "<-->" : "-->";
  return `<div class="entry"><strong>@</strong> ${escapeHtml(link.target)} ${escapeHtml(
    direction + label,
  )}</div>`;
}

function formatValue(value: FieldEntry["value"]): string {
  if (value.kind === "string") {
    return value.value;
  }
  if (value.kind === "number") {
    return String(value.value);
  }
  if (value.kind === "boolean") {
    return value.value ? "true" : "false";
  }
  if (value.kind === "multilineText") {
    return value.value;
  }
  if (value.kind === "list") {
    return formatListPart(value);
  }
  if (value.kind === "orderedList") {
    return formatListPart(value);
  }
  if (value.kind === "richText") {
    return value.parts
      .map((part) => {
        if (part.kind === "paragraph") {
          return part.text;
        }
        if (part.kind === "list") {
          return formatListPart(part);
        }
        if (part.kind === "orderedList") {
          return formatListPart(part);
        }
        if (part.kind === "annotation") {
          return `^ ${part.value}`;
        }
        return `${part.speaker} >${formatDialogueText(part)}`;
      })
      .join("\n");
  }
  return value.value;
}

function renderFieldValue(value: FieldEntry["value"]): string {
  if (value.kind === "multilineText") {
    return `<div class="multiline-field">${escapeHtml(value.value)}</div>`;
  }

  if (value.kind === "list") {
    return renderListPart(value);
  }

  if (value.kind === "orderedList") {
    return renderListPart(value);
  }

  if (value.kind === "richText") {
    return `<div class="rich-field">${renderRichTextParts(value.parts)}</div>`;
  }

  return escapeHtml(formatValue(value));
}

function renderRichTextParts(parts: readonly RichTextPart[]): string {
  const rendered: string[] = [];
  let dialogueGroup: { speaker: string; text: string }[] = [];

  const flushDialogueGroup = (): void => {
    if (!dialogueGroup.length) {
      return;
    }

    rendered.push(renderDialogueGroup(dialogueGroup));
    dialogueGroup = [];
  };

  for (const part of parts) {
    if (part.kind === "dialogue") {
      dialogueGroup.push(part);
      continue;
    }

    flushDialogueGroup();
    rendered.push(renderRichTextPart(part));
  }

  flushDialogueGroup();
  return rendered.join("");
}

function renderRichTextPart(part: RichTextPart): string {
  if (part.kind === "paragraph") {
    return `<div class="multiline-field">${escapeHtml(part.text)}</div>`;
  }

  if (part.kind === "list") {
    return renderListPart(part);
  }

  if (part.kind === "dialogue") {
    return renderDialogueGroup([part]);
  }

  if (part.kind === "annotation") {
    return `<div class="multiline-field annotation-entry"><em>${escapeHtml(
      part.value,
    )}</em></div>`;
  }

  return renderListPart(part);
}

type RenderableListPart =
  | {
      kind: "list";
      items: RenderableListItem[];
    }
  | {
      kind: "orderedList";
      items: RenderableOrderedListItem[];
    };

interface RenderableListItem {
  value: string;
  annotation?: string;
  children?: RenderableListPart[];
}

interface RenderableOrderedListItem extends RenderableListItem {
  number: number;
}

function renderListPart(part: RenderableListPart): string {
  if (part.kind === "list") {
    return `<ul class="field-list">${part.items
      .map((item) => renderListItem(item))
      .join("")}</ul>`;
  }

  return `<ol class="field-list">${part.items
    .map((item) => renderListItem(item, item.number))
    .join("")}</ol>`;
}

function renderListItem(item: RenderableListItem, number?: number): string {
  const valueAttribute = number === undefined ? "" : ` value="${number}"`;
  const children = item.children?.map((child) => renderListPart(child)).join("") ?? "";
  return `<li${valueAttribute}><span class="list-item-text">${escapeHtml(
    item.value,
  )}</span>${renderListItemAnnotation(item.annotation)}${children}</li>`;
}

function renderListItemAnnotation(annotation: string | undefined): string {
  if (annotation === undefined) {
    return "";
  }

  return `<em class="list-item-annotation">^ ${escapeHtml(annotation)}</em>`;
}

function renderInlineAnnotation(annotation: string | undefined): string {
  if (annotation === undefined) {
    return "";
  }

  return ` <em class="inline-annotation">^ ${escapeHtml(annotation)}</em>`;
}

function formatListPart(part: RenderableListPart, depth = 0): string {
  if (part.kind === "list") {
    return part.items
      .map((item) => formatListItemLine(item, "-", depth))
      .join("\n");
  }

  return part.items
    .map((item) => formatListItemLine(item, `${item.number}.`, depth))
    .join("\n");
}

function formatListItemLine(
  item: RenderableListItem,
  marker: string,
  depth: number,
): string {
  const indent = "  ".repeat(depth);
  const children = item.children?.map((child) => formatListPart(child, depth + 1)) ?? [];
  return [`${indent}${marker} ${formatListItemText(item)}`, ...children].join("\n");
}

function formatListItemText(item: { value: string; annotation?: string }): string {
  return item.annotation === undefined
    ? item.value
    : `${item.value} ^ ${item.annotation}`;
}

function formatDialogueText(entry: { text: string; annotation?: string }): string {
  return entry.annotation === undefined
    ? entry.text
    : `${entry.text} ^ ${entry.annotation}`;
}

function sourceLabel(sourcePath: string): string {
  return sourcePath.split(/[\\/]/).pop() ?? sourcePath;
}

function toVsCodeDiagnostic(diagnostic: RosemaryDiagnostic): vscode.Diagnostic {
  const result = new vscode.Diagnostic(
    toVsCodeRange(diagnostic.range),
    diagnostic.message,
    toVsCodeSeverity(diagnostic.severity),
  );
  result.code = diagnostic.code;
  result.source = "ROSEMARY";
  return result;
}

async function parseProjectForDocument(
  document: vscode.TextDocument,
): Promise<RosemaryProject> {
  return parseRosemaryProject(document.fileName, createProjectLoader());
}

function createProjectLoader(): RosemaryProjectLoader {
  return {
    async readFile(filePath: string): Promise<string> {
      const normalizedPath = normalizeFilePath(filePath);
      const openDocument = vscode.workspace.textDocuments.find(
        (document) =>
          isRosemaryDocument(document) &&
          normalizeFilePath(document.fileName) === normalizedPath,
      );

      if (openDocument) {
        return openDocument.getText();
      }

      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(normalizedPath));
      return Buffer.from(bytes).toString("utf8");
    },
    resolvePath(fromPath: string, includePath: string): string {
      return path.resolve(path.dirname(fromPath), includePath);
    },
    normalizePath: normalizeFilePath,
  };
}

function normalizeFilePath(filePath: string): string {
  return path.normalize(path.resolve(filePath));
}

function collectBlockFoldingRanges(
  blocks: readonly BlockNode[],
): vscode.FoldingRange[] {
  const ranges: vscode.FoldingRange[] = [];

  for (const block of blocks) {
    const startLine = block.range.start.line - 1;
    const endLine = block.range.end.line - 1;

    if (endLine > startLine) {
      ranges.push(
        new vscode.FoldingRange(
          startLine,
          endLine,
          vscode.FoldingRangeKind.Region,
        ),
      );
    }

    for (const entry of block.entries) {
      if (entry.kind === "block") {
        ranges.push(...collectBlockFoldingRanges([entry]));
      }
    }
  }

  return ranges;
}

function encodeFoldedBlockKey(sourcePath: string, startLine: number): string {
  return `${normalizeFilePath(sourcePath)}:${Math.floor(startLine)}`;
}

function decodeFoldedBlockKey(key: string): FoldedBlockState {
  const separator = key.lastIndexOf(":");
  if (separator === -1) {
    return {
      sourcePath: key,
      startLine: 0,
    };
  }

  return {
    sourcePath: key.slice(0, separator),
    startLine: Number(key.slice(separator + 1)),
  };
}

function setProjectDiagnostics(
  collection: vscode.DiagnosticCollection,
  project: RosemaryProject,
  fallbackUri: vscode.Uri,
): void {
  const diagnosticsByPath = new Map<string, vscode.Diagnostic[]>();

  for (const diagnostic of project.diagnostics) {
    const sourcePath = diagnostic.sourcePath ?? project.entryPath;
    const normalizedPath = normalizeFilePath(sourcePath);
    const diagnostics = diagnosticsByPath.get(normalizedPath) ?? [];
    diagnostics.push(toVsCodeDiagnostic(diagnostic));
    diagnosticsByPath.set(normalizedPath, diagnostics);
  }

  collection.clear();

  if (diagnosticsByPath.size === 0) {
    collection.set(fallbackUri, []);
    return;
  }

  for (const [sourcePath, diagnostics] of diagnosticsByPath) {
    collection.set(vscode.Uri.file(sourcePath), diagnostics);
  }
}

function toVsCodeRange(range: RosemaryDiagnostic["range"]): vscode.Range {
  return new vscode.Range(
    Math.max(0, range.start.line - 1),
    Math.max(0, range.start.column - 1),
    Math.max(0, range.end.line - 1),
    Math.max(0, range.end.column - 1),
  );
}

function toVsCodeSeverity(
  severity: RosemaryDiagnostic["severity"],
): vscode.DiagnosticSeverity {
  if (severity === "error") {
    return vscode.DiagnosticSeverity.Error;
  }
  if (severity === "warning") {
    return vscode.DiagnosticSeverity.Warning;
  }
  return vscode.DiagnosticSeverity.Information;
}

function createDiagnosticsSignature(
  diagnostics: readonly RosemaryDiagnostic[],
): string {
  return diagnostics
    .map(
      (diagnostic) =>
        `${diagnostic.severity}:${diagnostic.code ?? ""}:${
          diagnostic.range.start.line
        }:${diagnostic.range.start.column}:${diagnostic.message}`,
    )
    .join("\n");
}

function logDiagnostics(
  document: vscode.TextDocument,
  diagnostics: readonly RosemaryDiagnostic[],
): void {
  if (!diagnostics.length) {
    return;
  }

  for (const diagnostic of diagnostics) {
    const sourcePath = diagnostic.sourcePath ?? document.fileName;
    const message = `[ROSEMARY] ${sourcePath}:${diagnostic.range.start.line}:${diagnostic.range.start.column} ${diagnostic.message}`;
    if (diagnostic.severity === "error") {
      console.error(message);
    } else if (diagnostic.severity === "warning") {
      console.warn(message);
    } else {
      console.info(message);
    }
  }
}

function loadBlockReferenceHighlightConfig(): BlockReferenceHighlightConfig {
  const configuration = vscode.workspace.getConfiguration(
    "rosemary.blockReferenceHighlight",
  );
  const configuredExcludedNames = configuration.get<unknown>(
    "excludedBlockNames",
    [],
  );
  const configuredColors = configuration.get<unknown>("colors", {});
  const colors = { ...DEFAULT_BLOCK_REFERENCE_HIGHLIGHT_COLORS };

  if (isRecord(configuredColors)) {
    for (const [key, value] of Object.entries(configuredColors)) {
      if (typeof value === "string" && value.trim().length > 0) {
        colors[key] = value.trim();
      }
    }
  }

  return {
    enabled: configuration.get<boolean>("enabled", true),
    excludedBlockNames: new Set(
      Array.isArray(configuredExcludedNames)
        ? configuredExcludedNames.filter(
            (name): name is string =>
              typeof name === "string" && name.trim().length > 0,
          ).map((name) => name.trim())
        : [],
    ),
    colors,
  };
}

function buildBlockReferenceDecorationBuckets(
  document: vscode.TextDocument,
  project: RosemaryProject,
  config: BlockReferenceHighlightConfig,
): Map<string, vscode.DecorationOptions[]> {
  const buckets = new Map<string, vscode.DecorationOptions[]>();
  const targets = collectBlockReferenceTargets(project, config);
  if (!targets.length) {
    return buckets;
  }

  const sourceText = document.getText();
  const sourcePath = normalizeFilePath(document.fileName);
  const searchRanges = collectBlockReferenceSearchRanges(
    project.document.blocks,
    sourcePath,
  );
  const matches = findBlockReferenceMatches(sourceText, searchRanges, targets);

  for (const match of matches) {
    const color = match.target.color;
    const decorations = buckets.get(color) ?? [];
    decorations.push(
      ...createInlineDecorationOptions(document, sourceText, match),
    );
    buckets.set(color, decorations);
  }

  return buckets;
}

function createInlineDecorationOptions(
  document: vscode.TextDocument,
  sourceText: string,
  match: BlockReferenceMatch,
): vscode.DecorationOptions[] {
  const options: vscode.DecorationOptions[] = [];
  let offset = match.startOffset;

  for (const character of sourceText.slice(match.startOffset, match.endOffset)) {
    const nextOffset = offset + character.length;
    options.push({
      range: new vscode.Range(
        document.positionAt(offset),
        document.positionAt(nextOffset),
      ),
    });
    offset = nextOffset;
  }

  return options;
}

function collectBlockReferenceTargets(
  project: RosemaryProject,
  config: BlockReferenceHighlightConfig,
): BlockReferenceTarget[] {
  const targetsByName = new Map<string, BlockReferenceTarget>();

  for (const block of walkBlocks(project.document.blocks)) {
    const name = block.name.trim();
    if (
      !name ||
      name.includes("\n") ||
      name.includes("\r") ||
      config.excludedBlockNames.has(name) ||
      targetsByName.has(name)
    ) {
      continue;
    }

    const type = blockType(block);
    targetsByName.set(name, {
      name,
      type,
      color: blockReferenceColor(type, config),
      sourcePath: block.source?.path,
      range: block.range,
      block,
    });
  }

  return [...targetsByName.values()].sort(
    (a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name),
  );
}

function collectBlockReferenceSearchRanges(
  blocks: readonly BlockNode[],
  sourcePath: string,
): BlockReferenceSearchRange[] {
  const ranges: BlockReferenceSearchRange[] = [];

  for (const block of blocks) {
    collectBlockSearchRanges(block, sourcePath, ranges);
  }

  return ranges;
}

function collectBlockSearchRanges(
  block: BlockNode,
  sourcePath: string,
  ranges: BlockReferenceSearchRange[],
): void {
  if (!isNodeFromSource(block, sourcePath)) {
    return;
  }

  for (const entry of block.entries) {
    switch (entry.kind) {
      case "text":
      case "dialogue":
      case "question":
      case "answer":
      case "annotation":
        ranges.push(toSearchRange(entry.range));
        break;
      case "field":
        ranges.push(toSearchRange(entry.value.range));
        break;
      case "link":
        break;
      case "block":
        collectBlockSearchRanges(entry, sourcePath, ranges);
        break;
    }
  }
}

function findBlockReferenceMatches(
  sourceText: string,
  searchRanges: readonly BlockReferenceSearchRange[],
  targets: readonly BlockReferenceTarget[],
): BlockReferenceMatch[] {
  const matches: BlockReferenceMatch[] = [];

  for (const searchRange of searchRanges) {
    const startOffset = clamp(searchRange.startOffset, 0, sourceText.length);
    const endOffset = clamp(searchRange.endOffset, startOffset, sourceText.length);
    const sourceSlice = sourceText.slice(startOffset, endOffset);
    const rangeMatches: BlockReferenceMatch[] = [];

    for (const target of targets) {
      let index = sourceSlice.indexOf(target.name);
      while (index !== -1) {
        rangeMatches.push({
          startOffset: startOffset + index,
          endOffset: startOffset + index + target.name.length,
          target,
        });
        index = sourceSlice.indexOf(target.name, index + target.name.length);
      }
    }

    matches.push(...selectNonOverlappingMatches(rangeMatches));
  }

  return matches;
}

function findBlockReferenceMatchesAtOffset(
  sourceText: string,
  searchRanges: readonly BlockReferenceSearchRange[],
  targets: readonly BlockReferenceTarget[],
  offset: number,
): BlockReferenceMatch[] {
  const candidates: BlockReferenceMatch[] = [];
  const checkedOffsets = offset > 0 ? [offset, offset - 1] : [offset];

  for (const searchRange of searchRanges) {
    const startOffset = clamp(searchRange.startOffset, 0, sourceText.length);
    const endOffset = clamp(searchRange.endOffset, startOffset, sourceText.length);
    const offsetsInRange = checkedOffsets.filter(
      (candidateOffset) =>
        candidateOffset >= startOffset && candidateOffset < endOffset,
    );

    if (!offsetsInRange.length) {
      continue;
    }

    const sourceSlice = sourceText.slice(startOffset, endOffset);
    for (const target of targets) {
      let index = sourceSlice.indexOf(target.name);
      while (index !== -1) {
        const matchStart = startOffset + index;
        const matchEnd = matchStart + target.name.length;
        if (
          offsetsInRange.some(
            (candidateOffset) =>
              candidateOffset >= matchStart && candidateOffset < matchEnd,
          )
        ) {
          candidates.push({
            startOffset: matchStart,
            endOffset: matchEnd,
            target,
          });
        }
        index = sourceSlice.indexOf(target.name, index + 1);
      }
    }
  }

  return candidates.sort(
    (a, b) =>
      a.target.name.localeCompare(b.target.name, "ja") ||
      a.startOffset - b.startOffset ||
      b.endOffset - b.startOffset - (a.endOffset - a.startOffset),
  );
}

function selectNonOverlappingMatches(
  matches: readonly BlockReferenceMatch[],
): BlockReferenceMatch[] {
  const selected: BlockReferenceMatch[] = [];
  let occupiedEnd = -1;

  const sortedMatches = [...matches].sort(
    (a, b) =>
      a.startOffset - b.startOffset ||
      b.endOffset - b.startOffset - (a.endOffset - a.startOffset),
  );

  for (const match of sortedMatches) {
    if (match.startOffset < occupiedEnd) {
      continue;
    }
    selected.push(match);
    occupiedEnd = match.endOffset;
  }

  return selected;
}

function* walkBlocks(blocks: readonly BlockNode[]): Generator<BlockNode> {
  for (const block of blocks) {
    yield block;
    for (const entry of block.entries) {
      if (entry.kind === "block") {
        yield* walkBlocks([entry]);
      }
    }
  }
}

function blockReferenceColor(
  type: string | undefined,
  config: BlockReferenceHighlightConfig,
): string {
  if (type && config.colors[type]) {
    return config.colors[type];
  }
  return config.colors.default ?? DEFAULT_BLOCK_REFERENCE_HIGHLIGHT_COLORS.default;
}

function toSearchRange(range: RosemaryDiagnostic["range"]): BlockReferenceSearchRange {
  return {
    startOffset: range.start.offset,
    endOffset: range.end.offset,
  };
}

function isNodeFromSource(
  node: { source?: { path: string } },
  sourcePath: string,
): boolean {
  return node.source?.path ? normalizeFilePath(node.source.path) === sourcePath : true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatBlockReferenceHover(
  target: BlockReferenceTarget,
  fallbackPath: string,
): string {
  const block = target.block;
  const sourcePath = target.sourcePath ?? fallbackPath;
  const lines: string[] = [`### ${escapeMarkdown(block.name)}`];
  const meta = formatBlockHoverMeta(block);

  if (meta) {
    lines.push(meta);
  }

  lines.push(
    `_$(file) ${escapeMarkdown(sourceLabel(sourcePath))}:${block.range.start.line}_`,
  );

  const entries = formatBlockHoverEntries(block.entries);
  if (entries.length > 0) {
    lines.push("", "**内容**", ...entries);
  }

  return lines.join("\n");
}

function formatBlockHoverMeta(block: BlockNode): string {
  const parts: string[] = [];

  for (const attribute of block.attributes) {
    if (attribute.value === undefined) {
      parts.push(formatHoverCode(attribute.name));
    } else {
      parts.push(
        `${formatHoverCode(attribute.name)}=${formatHoverCode(
          truncateForHover(formatValue(attribute.value), 80),
        )}`,
      );
    }
  }

  for (const tag of block.tags) {
    parts.push(formatHoverCode(`#${tag.name}`));
  }

  return parts.join(" ");
}

function formatBlockHoverEntries(entries: readonly BlockEntry[]): string[] {
  const lines: string[] = [];
  const maxEntries = 18;

  for (const entry of entries) {
    if (lines.length >= maxEntries) {
      lines.push("- ...");
      break;
    }

    const formatted = formatBlockHoverEntry(entry);
    if (formatted) {
      lines.push(formatted);
    }
  }

  return lines;
}

function formatBlockHoverEntry(entry: BlockEntry): string {
  switch (entry.kind) {
    case "text":
      return `- ${escapeMarkdown(truncateForHover(entry.value, 140))}`;
    case "field":
      return `- **${escapeMarkdown(entry.name)}:** ${escapeMarkdown(
        truncateForHover(formatValue(entry.value), 180),
      )}`;
    case "dialogue":
      return `- **${escapeMarkdown(entry.speaker)}:** ${escapeMarkdown(
        truncateForHover(formatDialogueText(entry), 160),
      )}`;
    case "link":
      return `- @ ${escapeMarkdown(entry.target)} ${escapeMarkdown(
        formatLinkLine(entry),
      )}`;
    case "question":
      return `- ? ${escapeMarkdown(truncateForHover(entry.value, 160))}`;
    case "answer":
      return `- ! ${escapeMarkdown(truncateForHover(entry.value, 160))}`;
    case "annotation":
      return `- ^ _${escapeMarkdown(truncateForHover(entry.value, 160))}_`;
    case "block": {
      const type = blockType(entry);
      return `- ${formatHoverCode("block")} ${escapeMarkdown(entry.name)}${
        type ? ` ${formatHoverCode(type)}` : ""
      }`;
    }
  }
}

function formatLinkLine(link: LinkEntry): string {
  const direction = link.line?.direction === "bidirectional" ? "<-->" : "-->";
  const label = link.line?.label ? ` ${link.line.label}` : "";
  return `${direction}${label}`;
}

function formatHoverCode(value: string): string {
  const escaped = value.replace(/`/g, "\\`");
  return `\`${escaped}\``;
}

function truncateForHover(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1");
}

async function jumpToBlockDefinitionAtCursor(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isRosemaryDocument(editor.document)) {
    void vscode.window.showWarningMessage("Open a .rsmr file first.");
    return;
  }

  const config = loadBlockReferenceHighlightConfig();
  if (!config.enabled) {
    void vscode.window.showInformationMessage(
      "ROSEMARY block reference highlighting is disabled.",
    );
    return;
  }

  let project: RosemaryProject;
  try {
    project = await parseProjectForDocument(editor.document);
  } catch (error) {
    console.error(`[ROSEMARY] Failed to resolve block definitions.`, error);
    void vscode.window.showErrorMessage("Failed to resolve ROSEMARY block definitions.");
    return;
  }

  const sourceText = editor.document.getText();
  const sourcePath = normalizeFilePath(editor.document.fileName);
  const targets = collectBlockReferenceTargets(project, config);
  const searchRanges = collectBlockReferenceSearchRanges(
    project.document.blocks,
    sourcePath,
  );
  const offset = editor.document.offsetAt(editor.selection.active);
  const matches = dedupeBlockReferenceMatches(
    findBlockReferenceMatchesAtOffset(sourceText, searchRanges, targets, offset),
  );

  if (!matches.length) {
    void vscode.window.showInformationMessage(
      "No ROSEMARY block reference was found at the cursor.",
    );
    return;
  }

  const selected =
    matches.length === 1
      ? matches[0]
      : await vscode.window.showQuickPick(
          matches.map((match) => ({
            label: `${match.target.name}の定義へジャンプ`,
            description: sourceLabel(
              match.target.sourcePath ?? project.entryPath,
            ),
            match,
          })),
          {
            placeHolder: "ジャンプする block 定義を選択してください",
          },
        ).then((item) => item?.match);

  if (!selected) {
    return;
  }

  await revealBlockDefinition(selected.target, project.entryPath);
}

function dedupeBlockReferenceMatches(
  matches: readonly BlockReferenceMatch[],
): BlockReferenceMatch[] {
  const seen = new Set<string>();
  const deduped: BlockReferenceMatch[] = [];

  for (const match of matches) {
    const key = `${match.target.name}:${match.target.sourcePath ?? ""}:${
      match.target.range.start.offset
    }`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(match);
  }

  return deduped;
}

async function revealBlockDefinition(
  target: BlockReferenceTarget,
  fallbackPath: string,
): Promise<void> {
  const sourcePath = normalizeFilePath(target.sourcePath ?? fallbackPath);
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(sourcePath));
  const editor = await vscode.window.showTextDocument(document, {
    preview: false,
  });
  const range = toVsCodeRange(target.range);
  editor.selection = new vscode.Selection(range.start, range.start);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

async function handleRosemaryEnter(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (
    !isRosemaryListEditingEnabled() ||
    !editor ||
    !isRosemaryDocument(editor.document) ||
    editor.selections.length !== 1 ||
    !editor.selection.isEmpty
  ) {
    await insertDefaultNewline();
    return;
  }

  const position = editor.selection.active;
  if (!isInsideFieldBlockValue(editor.document, position.line)) {
    await insertDefaultNewline();
    return;
  }

  const line = editor.document.lineAt(position.line);
  const beforeCursor = line.text.slice(0, position.character);
  const afterCursor = line.text.slice(position.character);

  if (afterCursor.trim().length > 0) {
    await insertDefaultNewline();
    return;
  }

  const emptyUnordered = /^(\s*)-\s*$/.exec(beforeCursor);
  if (emptyUnordered) {
    await replaceCurrentLine(editor, emptyUnordered[1] ?? "");
    return;
  }

  const emptyOrdered = /^(\s*)\d+\.\s*$/.exec(beforeCursor);
  if (emptyOrdered) {
    await replaceCurrentLine(editor, emptyOrdered[1] ?? "");
    return;
  }

  const unordered = /^(\s*)-\s+\S.*$/.exec(beforeCursor);
  if (unordered) {
    await insertListContinuation(editor, `${unordered[1] ?? ""}- `);
    return;
  }

  const ordered = /^(\s*)(\d+)\.\s+\S.*$/.exec(beforeCursor);
  if (ordered) {
    const indent = ordered[1] ?? "";
    const nextNumber = Number(ordered[2]) + 1;
    await insertListContinuation(editor, `${indent}${nextNumber}. `);
    return;
  }

  await insertDefaultNewline();
}

async function handleRosemaryTab(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (
    !isRosemaryListEditingEnabled() ||
    !editor ||
    !isRosemaryDocument(editor.document) ||
    editor.selections.length !== 1 ||
    !editor.selection.isEmpty
  ) {
    await insertDefaultTab();
    return;
  }

  const position = editor.selection.active;
  if (!isInsideFieldBlockValue(editor.document, position.line)) {
    await insertDefaultTab();
    return;
  }

  const line = editor.document.lineAt(position.line);
  const listLine = /^(\s*)(-|\d+\.)(\s*)(.*)$/.exec(line.text);
  if (!listLine) {
    await insertDefaultTab();
    return;
  }

  const indent = listLine[1] ?? "";
  const marker = listLine[2] ?? "";
  const spacing = listLine[3] && listLine[3].length > 0 ? listLine[3] : " ";
  const rest = listLine[4] ?? "";
  const indentUnit = getEditorIndentUnit(editor);
  const nextMarker = /^\d+\.$/.test(marker) && rest.trim().length === 0 ? "1." : marker;
  const replacement = `${indent}${indentUnit}${nextMarker}${spacing}${rest}`;
  const markerDelta = nextMarker.length - marker.length;
  const nextCharacter = Math.max(0, position.character + indentUnit.length + markerDelta);
  const nextPosition = new vscode.Position(position.line, nextCharacter);

  await editor.edit((edit) => {
    edit.replace(line.range, replacement);
  });
  editor.selection = new vscode.Selection(nextPosition, nextPosition);
}

async function maybeHandleRosemaryListEnterChange(
  event: vscode.TextDocumentChangeEvent,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (
    !editor ||
    editor.document.uri.toString() !== event.document.uri.toString() ||
    !isRosemaryDocument(event.document) ||
    event.contentChanges.length !== 1
  ) {
    return;
  }

  const change = event.contentChanges[0];
  if (!change || !change.range.isEmpty || countNewlines(change.text) !== 1) {
    return;
  }

  const previousLineNumber = change.range.start.line;
  const nextLineNumber = previousLineNumber + 1;
  if (
    previousLineNumber < 0 ||
    nextLineNumber >= event.document.lineCount ||
    !isInsideFieldBlockValue(event.document, previousLineNumber)
  ) {
    return;
  }

  const previousLine = event.document.lineAt(previousLineNumber);
  const nextLine = event.document.lineAt(nextLineNumber);
  if (nextLine.text.trim().length > 0) {
    return;
  }

  const emptyUnordered = /^(\s*)-\s*$/.exec(previousLine.text);
  if (emptyUnordered) {
    await collapseEmptyListMarkerAfterDefaultEnter(
      editor,
      previousLineNumber,
      nextLineNumber,
      emptyUnordered[1] ?? "",
    );
    return;
  }

  const emptyOrdered = /^(\s*)\d+\.\s*$/.exec(previousLine.text);
  if (emptyOrdered) {
    await collapseEmptyListMarkerAfterDefaultEnter(
      editor,
      previousLineNumber,
      nextLineNumber,
      emptyOrdered[1] ?? "",
    );
    return;
  }

  const unordered = /^(\s*)-\s+\S.*$/.exec(previousLine.text);
  if (unordered) {
    await replaceDefaultEnterIndent(editor, nextLineNumber, `${unordered[1] ?? ""}- `);
    return;
  }

  const ordered = /^(\s*)(\d+)\.\s+\S.*$/.exec(previousLine.text);
  if (ordered) {
    const indent = ordered[1] ?? "";
    const nextNumber = Number(ordered[2]) + 1;
    await replaceDefaultEnterIndent(editor, nextLineNumber, `${indent}${nextNumber}. `);
  }
}

async function replaceCurrentLine(
  editor: vscode.TextEditor,
  replacement: string,
): Promise<void> {
  const lineNumber = editor.selection.active.line;
  const line = editor.document.lineAt(lineNumber);
  const nextPosition = new vscode.Position(lineNumber, replacement.length);

  await editor.edit((edit) => {
    edit.replace(line.range, replacement);
  });
  editor.selection = new vscode.Selection(nextPosition, nextPosition);
}

async function collapseEmptyListMarkerAfterDefaultEnter(
  editor: vscode.TextEditor,
  previousLineNumber: number,
  nextLineNumber: number,
  replacement: string,
): Promise<void> {
  const nextLine = editor.document.lineAt(nextLineNumber);
  const range = new vscode.Range(
    new vscode.Position(previousLineNumber, 0),
    new vscode.Position(nextLineNumber, nextLine.text.length),
  );
  const nextPosition = new vscode.Position(previousLineNumber, replacement.length);

  await editor.edit((edit) => {
    edit.replace(range, replacement);
  });
  editor.selection = new vscode.Selection(nextPosition, nextPosition);
}

async function replaceDefaultEnterIndent(
  editor: vscode.TextEditor,
  lineNumber: number,
  replacement: string,
): Promise<void> {
  const line = editor.document.lineAt(lineNumber);
  const nextPosition = new vscode.Position(lineNumber, replacement.length);

  await editor.edit((edit) => {
    edit.replace(line.range, replacement);
  });
  editor.selection = new vscode.Selection(nextPosition, nextPosition);
}

async function insertListContinuation(
  editor: vscode.TextEditor,
  marker: string,
): Promise<void> {
  const position = editor.selection.active;
  const nextPosition = new vscode.Position(position.line + 1, marker.length);

  await editor.edit((edit) => {
    edit.insert(position, `\n${marker}`);
  });
  editor.selection = new vscode.Selection(nextPosition, nextPosition);
}

async function insertDefaultNewline(): Promise<void> {
  try {
    await vscode.commands.executeCommand("default:type", { text: "\n" });
  } catch {
    await vscode.commands.executeCommand("type", { text: "\n" });
  }
}

async function insertDefaultTab(): Promise<void> {
  try {
    await vscode.commands.executeCommand("tab");
  } catch {
    const editor = vscode.window.activeTextEditor;
    const text = editor ? getEditorIndentUnit(editor) : "\t";
    await vscode.commands.executeCommand("default:type", { text });
  }
}

function isRosemaryListEditingEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("rosemary.listEditing")
    .get<boolean>("enabled", true);
}

function getEditorIndentUnit(editor: vscode.TextEditor): string {
  const tabSizeOption = editor.options.tabSize;
  const tabSize =
    typeof tabSizeOption === "number" && Number.isFinite(tabSizeOption)
      ? Math.max(1, Math.floor(tabSizeOption))
      : 4;

  return editor.options.insertSpaces === false ? "\t" : " ".repeat(tabSize);
}

function isInsideFieldBlockValue(
  document: vscode.TextDocument,
  lineNumber: number,
): boolean {
  for (let currentLine = lineNumber; currentLine >= 0; currentLine -= 1) {
    const text = document.lineAt(currentLine).text;
    if (currentLine !== lineNumber && /^\s*\]\s*$/.test(text)) {
      return false;
    }

    if (FIELD_BLOCK_OPEN_PATTERN.test(text)) {
      return true;
    }
  }

  return false;
}

function countNewlines(value: string): number {
  return value.split("\n").length - 1;
}

function isRosemaryDocument(document: vscode.TextDocument): boolean {
  return (
    document.languageId === ROSEMARY_LANGUAGE_ID ||
    document.fileName.toLowerCase().endsWith(".rsmr")
  );
}

interface PreviewVisibleBlockMessage {
  type: "previewVisibleBlock";
  line: number;
}

interface PreviewHoverBlockMessage {
  type: "previewHoverBlock";
  startLine: number;
  endLine: number;
}

interface PreviewBlockFoldStateMessage {
  type: "previewBlockFoldState";
  sourcePath: string;
  startLine: number;
  collapsed: boolean;
}

interface PreviewToggleBlockFoldMessage {
  type: "previewToggleBlockFold";
  sourcePath: string;
  startLine: number;
  collapsed: boolean;
}

function isPreviewVisibleBlockMessage(
  message: unknown,
): message is PreviewVisibleBlockMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "previewVisibleBlock" &&
    "line" in message &&
    typeof message.line === "number"
  );
}

function isPreviewHoverBlockMessage(
  message: unknown,
): message is PreviewHoverBlockMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "previewHoverBlock" &&
    "startLine" in message &&
    typeof message.startLine === "number" &&
    "endLine" in message &&
    typeof message.endLine === "number"
  );
}

function isPreviewBlockFoldStateMessage(
  message: unknown,
): message is PreviewBlockFoldStateMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "previewBlockFoldState" &&
    hasFoldMessageShape(message)
  );
}

function isPreviewToggleBlockFoldMessage(
  message: unknown,
): message is PreviewToggleBlockFoldMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "previewToggleBlockFold" &&
    hasFoldMessageShape(message)
  );
}

function hasFoldMessageShape(
  message: object,
): message is {
  sourcePath: string;
  startLine: number;
  collapsed: boolean;
} {
  return (
    "sourcePath" in message &&
    typeof message.sourcePath === "string" &&
    "startLine" in message &&
    typeof message.startLine === "number" &&
    "collapsed" in message &&
    typeof message.collapsed === "boolean"
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function createNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let index = 0; index < 32; index += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
