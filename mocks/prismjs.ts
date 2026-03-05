type PrismTokenContent = string | Array<string | PrismToken>;

class PrismToken {
  alias?: string;
  content: PrismTokenContent;
  length: number;
  type: string;

  constructor(type: string, content: PrismTokenContent, alias?: string, matched?: string) {
    this.type = type;
    this.content = content;
    this.alias = alias;
    this.length = (matched ?? '').length;
  }
}

interface PrismMock {
  disableWorkerMessageHandler: boolean;
  hooks: {
    add: () => void;
    all: Record<string, unknown>;
    run: () => void;
  };
  languages: Record<string, unknown>;
  manual: boolean;
  Token: typeof PrismToken;
  tokenize: (code: string) => Array<string | PrismToken>;
}

const languages: Record<string, unknown> = {
  c: {},
  clike: {},
  cpp: {},
  css: {},
  java: {},
  javascript: {},
  markdown: {},
  markup: {},
  objectivec: {},
  plain: {},
  plaintext: {},
  powershell: {},
  python: {},
  rust: {},
  sql: {},
  swift: {},
  text: {},
  typescript: {},
  xml: {},
};

const Prism: PrismMock = {
  Token: PrismToken,
  disableWorkerMessageHandler: true,
  hooks: {
    add: () => {},
    all: {},
    run: () => {},
  },
  languages,
  manual: true,
  tokenize: (code: string) => [code],
};

Object.assign(globalThis as Record<string, unknown>, { Prism });

export default Prism;
