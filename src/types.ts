export interface LtMatch {
  message: string;
  shortMessage?: string;
  offset: number;
  length: number;
  replacements: { value: string }[];
  rule: {
    id: string;
    description: string;
    issueType?: string;
    category: { id: string; name: string };
  };
}

export type Request =
  | { type: "check"; text: string }
  | { type: "addWord"; word: string }
  | { type: "disableRule"; ruleId: string }
  | { type: "status"; enabled: boolean };

export type CheckResponse =
  | { ok: true; matches: LtMatch[]; language?: string }
  | { ok: false; error: string };
