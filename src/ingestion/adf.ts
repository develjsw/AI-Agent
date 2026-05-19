// Atlassian Document Format (ADF) → markdown 변환
// Jira/Confluence 모두 동일한 ADF 트리를 반환하므로 공용으로 사용

export interface AdfNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
}

export function isAdfNode(value: unknown): value is AdfNode {
  return typeof value === "object" && value !== null;
}

function headingLevel(attrs: Record<string, unknown> | undefined): number {
  const level = attrs?.level;
  if (typeof level === "number") return level;
  return 1;
}

export function adfToText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (!isAdfNode(node)) return "";

  const children = (node.content ?? []).map(adfToText).join("");

  switch (node.type) {
    case "text":
      return node.text ?? "";
    case "hardBreak":
      return "\n";
    case "paragraph":
      return children + "\n\n";
    case "heading":
      return `${"#".repeat(headingLevel(node.attrs))} ${children}\n\n`;
    case "bulletList":
      return (
        (node.content ?? [])
          .map((item) => `- ${adfToText(item).trim()}\n`)
          .join("") + "\n"
      );
    case "orderedList":
      return (
        (node.content ?? [])
          .map((item, index) => `${index + 1}. ${adfToText(item).trim()}\n`)
          .join("") + "\n"
      );
    case "listItem":
      return children;
    case "codeBlock":
      return "```\n" + children + "\n```\n\n";
    case "blockquote":
      return children
        .split("\n")
        .map((line) => {
          if (!line) return line;
          return `> ${line}`;
        })
        .join("\n");
    case "rule":
      return "\n---\n";
    case "doc":
      return children;
    // 알 수 없는 타입은 자식 노드만 이어붙여 내용 손실 방지
    default:
      return children;
  }
}
