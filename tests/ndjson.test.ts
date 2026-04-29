import { describe, it, expect } from "vitest";
import { NdjsonParser } from "../src/ndjson.js";

function collect(parser: NdjsonParser, capture: { msgs: unknown[]; errs: string[] }) {
  return {
    feed: (s: string) => parser.feed(s),
    flush: () => parser.flush(),
    msgs: capture.msgs,
    errs: capture.errs,
  };
}

function makeParser() {
  const cap = { msgs: [] as unknown[], errs: [] as string[] };
  const parser = new NdjsonParser({
    onMessage: (v) => cap.msgs.push(v),
    onError: (e) => cap.errs.push(e.message),
  });
  return collect(parser, cap);
}

describe("NdjsonParser", () => {
  it("parses a single complete JSON line", () => {
    const p = makeParser();
    p.feed('{"a":1}\n');
    expect(p.msgs).toEqual([{ a: 1 }]);
    expect(p.errs).toEqual([]);
  });

  it("parses multiple JSON objects in one chunk", () => {
    const p = makeParser();
    p.feed('{"a":1}\n{"b":2}\n{"c":3}\n');
    expect(p.msgs).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("handles JSON split across multiple chunks", () => {
    const p = makeParser();
    p.feed('{"hello":');
    p.feed('"wor');
    p.feed('ld"}\n');
    expect(p.msgs).toEqual([{ hello: "world" }]);
  });

  it("ignores blank lines and CRLF", () => {
    const p = makeParser();
    p.feed("\r\n\n");
    p.feed('{"x":1}\r\n');
    p.feed("\n");
    expect(p.msgs).toEqual([{ x: 1 }]);
    expect(p.errs).toEqual([]);
  });

  it("reports errors for invalid JSON without throwing", () => {
    const p = makeParser();
    p.feed("not-json\n");
    p.feed('{"ok":true}\n');
    expect(p.msgs).toEqual([{ ok: true }]);
    expect(p.errs.length).toBe(1);
  });

  it("flushes a trailing line without newline", () => {
    const p = makeParser();
    p.feed('{"final":true}');
    expect(p.msgs).toEqual([]);
    p.flush();
    expect(p.msgs).toEqual([{ final: true }]);
  });
});
