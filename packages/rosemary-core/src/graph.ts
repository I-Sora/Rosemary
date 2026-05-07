import {
  type Attribute,
  type BlockNode,
  type LineDirection,
  type LineStyle,
  type RosemaryDocument,
  type Tag,
  hasAttribute,
} from "./ast.js";

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphNode {
  id: string;
  name: string;
  type?: string;
  attributes: Attribute[];
  tags: Tag[];
  text: string[];
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  style: LineStyle;
  direction: LineDirection;
  label?: string;
  attributes: Attribute[];
  tags: Tag[];
}

export function buildGraph(document: RosemaryDocument): GraphModel {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nameToId = new Map<string, string>();

  for (const block of document.blocks) {
    collectNodes(block, [], nodes, nameToId);
  }

  for (const block of document.blocks) {
    collectEdges(block, nameToId, edges);
  }

  return { nodes, edges };
}

function collectNodes(
  block: BlockNode,
  path: string[],
  nodes: GraphNode[],
  nameToId: Map<string, string>,
): void {
  const id = [...path, block.name].join("/");
  if (isGraphVisibleBlock(block)) {
    if (!nameToId.has(block.name)) {
      nameToId.set(block.name, id);
    }

    nodes.push({
      id,
      name: block.name,
      type: block.attributes.find((attribute) => attribute.value === undefined)
        ?.name,
      attributes: block.attributes,
      tags: block.tags,
      text: block.entries
        .filter((entry) => entry.kind === "text")
        .map((entry) => entry.value),
    });
  }

  for (const entry of block.entries) {
    if (entry.kind === "block") {
      collectNodes(entry, [...path, block.name], nodes, nameToId);
    }
  }
}

function collectEdges(
  block: BlockNode,
  nameToId: Map<string, string>,
  edges: GraphEdge[],
): void {
  const source = nameToId.get(block.name);

  for (const entry of block.entries) {
    if (entry.kind === "link") {
      const target = nameToId.get(entry.target);
      if (!source || !target) {
        continue;
      }

      const style = entry.line?.style ?? "solid";
      const direction = entry.line?.direction ?? "forward";
      edges.push({
        id: `${source}->${entry.target}:${edges.length}`,
        source,
        target,
        style,
        direction,
        label: entry.line?.label,
        attributes: entry.attributes,
        tags: entry.tags,
      });
    } else if (entry.kind === "block") {
      collectEdges(entry, nameToId, edges);
    }
  }
}

export function isCharacterNode(node: GraphNode): boolean {
  return node.attributes.some((attribute) => attribute.name === "character");
}

export function isRelationshipBlock(block: BlockNode): boolean {
  return hasAttribute(block, "relationship");
}

function isGraphVisibleBlock(block: BlockNode): boolean {
  return !hasAttribute(block, "state");
}
