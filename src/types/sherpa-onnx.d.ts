declare module 'sherpa-onnx-node' {
  export class KeywordSpotter {
    constructor(config: any);
    createStream(): any;
    isReady(stream: any): boolean;
    decode(stream: any): void;
    getResult(stream: any): { keyword: string };
    free(): void;
  }
}

declare module 'sherpa-onnx-node/non-streaming-asr' {
  export class OfflineRecognizer {
    constructor(config: any);
    createStream(): any;
    decode(stream: any): void;
    getResult(stream: any): { text: string };
    free(): void;
  }
}
