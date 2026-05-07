import {
  type BlockNode,
  type Diagnostic,
  type LinkEntry,
  getAttribute,
  hasAttribute,
} from "./ast.js";
import type { RosemaryDocument } from "./ast.js";

export function validateDocument(document: RosemaryDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const blockNames = new Map<string, BlockNode>();
  const links: Array<{ link: LinkEntry; sourcePath?: string }> = [];

  for (const block of walkBlocks(document.blocks)) {
    if (!hasAttribute(block, "state")) {
      const existing = blockNames.get(block.name);
      if (existing) {
        diagnostics.push({
          severity: "warning",
          message: `Block name "${block.name}" is defined more than once.`,
          range: block.range,
          code: "duplicate-block-name",
          sourcePath: block.source?.path,
        });
      } else {
        blockNames.set(block.name, block);
      }
    }

    if (
      hasAttribute(block, "state") &&
      !getAttribute(block, "at") &&
      !getAttribute(block, "from") &&
      !getAttribute(block, "to")
    ) {
      diagnostics.push({
        severity: "warning",
        message: "State block should define `at`, `from`, or `to`.",
        range: block.range,
        code: "state-without-time",
        sourcePath: block.source?.path,
      });
    }

    for (const entry of block.entries) {
      if (entry.kind === "link") {
        links.push({ link: entry, sourcePath: block.source?.path });
      }
    }
  }

  for (const { link, sourcePath } of links) {
    if (!blockNames.has(link.target)) {
      diagnostics.push({
        severity: "error",
        message: `Link target "${link.target}" is not defined.`,
        range: link.range,
        code: "undefined-link-target",
        sourcePath,
      });
    }
  }

  return diagnostics;
}

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
