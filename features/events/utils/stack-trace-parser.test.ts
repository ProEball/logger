import { describe, it, expect } from "vitest";
import { parseStackTrace } from "./stack-trace-parser";

describe("parseStackTrace", () => {
    it("parses V8 frames with function", () => {
        const raw = `Error: something went wrong
    at myFunction (app.js:10:5)
    at Object.<anonymous> (main.js:20:3)`;
        const frames = parseStackTrace(raw);
        expect(frames).toHaveLength(2);
        expect(frames[0]).toMatchObject({ function: "myFunction", file: "app.js", line: 10, column: 5 });
        expect(frames[1]).toMatchObject({ function: "Object.<anonymous>", file: "main.js", line: 20 });
    });

    it("parses V8 frames without function name", () => {
        const raw = `    at /path/to/file.js:15:3`;
        const frames = parseStackTrace(raw);
        expect(frames).toHaveLength(1);
        expect(frames[0]).toMatchObject({ file: "/path/to/file.js", line: 15, column: 3 });
    });

    it("parses Python frames", () => {
        const raw = `Traceback (most recent call last):
  File "app.py", line 42, in handle_request
  File "models.py", line 7, in get_user`;
        const frames = parseStackTrace(raw);
        expect(frames).toHaveLength(2);
        expect(frames[0]).toMatchObject({ file: "app.py", line: 42, function: "handle_request" });
    });

    it("parses Java frames", () => {
        const raw = `java.lang.NullPointerException
\tat com.example.Service.process(Service.java:42)
\tat com.example.Controller.get(Controller.java:15)`;
        const frames = parseStackTrace(raw);
        expect(frames).toHaveLength(2);
        expect(frames[0]).toMatchObject({ function: "com.example.Service.process", file: "Service.java", line: 42 });
    });

    it("returns empty array for empty string", () => {
        expect(parseStackTrace("")).toHaveLength(0);
    });

    it("returns raw frames for unrecognized lines that start with 'at'", () => {
        const raw = `    at something unparseable`;
        const frames = parseStackTrace(raw);
        expect(frames).toHaveLength(1);
        expect(frames[0].raw).toContain("something unparseable");
    });
});
