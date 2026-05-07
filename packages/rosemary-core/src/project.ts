import {
  type Diagnostic,
  type IncludeNode,
  type Position,
  type Range,
  type RosemaryDocument,
} from "./ast.js";
import { validateDocument } from "./diagnostics.js";
import { parseRosemary } from "./parser.js";

export interface RosemaryProjectFile {
  path: string;
  document: RosemaryDocument;
}

export interface RosemaryProject {
  entryPath: string;
  document: RosemaryDocument;
  files: RosemaryProjectFile[];
  diagnostics: Diagnostic[];
}

export interface RosemaryProjectLoader {
  readFile(path: string): Promise<string>;
  resolvePath(fromPath: string, includePath: string): string;
  normalizePath?(path: string): string;
}

export async function parseRosemaryProject(
  entryPath: string,
  loader: RosemaryProjectLoader,
): Promise<RosemaryProject> {
  const resolver = new ProjectResolver(entryPath, loader);
  return resolver.parse();
}

class ProjectResolver {
  private readonly files = new Map<string, RosemaryProjectFile>();
  private readonly diagnostics: Diagnostic[] = [];
  private entryDocument: RosemaryDocument | undefined;

  constructor(
    private readonly entryPath: string,
    private readonly loader: RosemaryProjectLoader,
  ) {}

  async parse(): Promise<RosemaryProject> {
    const normalizedEntryPath = this.normalize(this.entryPath);
    await this.visit(normalizedEntryPath, []);

    const files = [...this.files.values()];
    const entryDocument = this.entryDocument ?? createEmptyDocument(normalizedEntryPath);
    const document: RosemaryDocument = {
      ...entryDocument,
      includes: files.flatMap((file) => file.document.includes),
      blocks: files.flatMap((file) => file.document.blocks),
      diagnostics: [],
      range: entryDocument.range,
    };

    const diagnostics = [
      ...this.diagnostics,
      ...validateDocument(document),
    ];
    document.diagnostics = diagnostics;

    return {
      entryPath: normalizedEntryPath,
      document,
      files,
      diagnostics,
    };
  }

  private async visit(
    path: string,
    stack: string[],
    includeNode?: IncludeNode,
  ): Promise<void> {
    const normalizedPath = this.normalize(path);

    if (stack.includes(normalizedPath)) {
      this.diagnostics.push({
        severity: "error",
        message: `Circular include detected: ${[...stack, normalizedPath].join(" -> ")}`,
        range: includeNode?.range ?? zeroRange(),
        code: "circular-include",
        sourcePath: includeNode?.source?.path,
      });
      return;
    }

    if (this.files.has(normalizedPath)) {
      return;
    }

    let source: string;
    try {
      source = await this.loader.readFile(normalizedPath);
    } catch {
      this.diagnostics.push({
        severity: "error",
        message: `Included file could not be read: ${normalizedPath}`,
        range: includeNode?.range ?? zeroRange(),
        code: "include-read-failed",
        sourcePath: includeNode?.source?.path ?? normalizedPath,
      });
      return;
    }

    const { document } = parseRosemary(source, {
      sourcePath: normalizedPath,
    });
    const projectFile: RosemaryProjectFile = {
      path: normalizedPath,
      document,
    };

    if (normalizedPath === this.normalize(this.entryPath)) {
      this.entryDocument = document;
    }

    this.files.set(normalizedPath, projectFile);
    this.diagnostics.push(...document.diagnostics);

    for (const include of document.includes) {
      if (!include.path.endsWith(".rsmr")) {
        this.diagnostics.push({
          severity: "error",
          message: `Include path should point to a .rsmr file: ${include.path}`,
          range: include.range,
          code: "invalid-include-extension",
          sourcePath: include.source?.path,
        });
        continue;
      }

      const resolvedPath = this.normalize(
        this.loader.resolvePath(normalizedPath, include.path),
      );
      await this.visit(resolvedPath, [...stack, normalizedPath], include);
    }
  }

  private normalize(path: string): string {
    return this.loader.normalizePath?.(path) ?? path;
  }
}

function createEmptyDocument(sourcePath: string): RosemaryDocument {
  const range = zeroRange();
  return {
    kind: "document",
    includes: [],
    blocks: [],
    diagnostics: [],
    range,
    source: { path: sourcePath },
  };
}

function zeroRange(): Range {
  const position: Position = {
    offset: 0,
    line: 1,
    column: 1,
  };
  return {
    start: position,
    end: position,
  };
}

