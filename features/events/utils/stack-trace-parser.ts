export type ParsedFrame = {
    raw: string;
    function?: string;
    file?: string;
    line?: number;
    column?: number;
};

// V8 (Node.js / Chrome): "    at FunctionName (file.js:10:5)" or "    at file.js:10:5"
const V8_FRAME_RE = /^\s*at\s+(?:(.+?)\s+\((.+?)(?::(\d+))?(?::(\d+))?\)|(.+?)(?::(\d+))?(?::(\d+))?)\s*$/;

// Python: "  File \"file.py\", line 10, in func_name"
const PYTHON_FRAME_RE = /^\s*File\s+"(.+?)",\s*line\s+(\d+),\s*in\s+(.+)\s*$/;

// Java: "  at com.example.Class.method(File.java:42)"
const JAVA_FRAME_RE = /^\s*at\s+([\w.$]+)\(([\w$.]+\.java):(\d+)\)\s*$/;

function parseV8(line: string): ParsedFrame | null {
    const m = V8_FRAME_RE.exec(line);
    if (!m) return null;

    if (m[1] && m[2]) {
        return {
            raw: line,
            function: m[1].trim(),
            file: m[2],
            line: m[3] ? Number(m[3]) : undefined,
            column: m[4] ? Number(m[4]) : undefined,
        };
    }
    if (m[5]) {
        return {
            raw: line,
            file: m[5],
            line: m[6] ? Number(m[6]) : undefined,
            column: m[7] ? Number(m[7]) : undefined,
        };
    }
    return null;
}

function parsePython(line: string): ParsedFrame | null {
    const m = PYTHON_FRAME_RE.exec(line);
    if (!m) return null;
    return { raw: line, file: m[1], line: Number(m[2]), function: m[3].trim() };
}

function parseJava(line: string): ParsedFrame | null {
    const m = JAVA_FRAME_RE.exec(line);
    if (!m) return null;
    return { raw: line, function: m[1], file: m[2], line: Number(m[3]) };
}

/**
 * Parse a raw stack trace string into structured frames.
 * Supports V8 (Node/Chrome), Python, Java.
 * Unrecognized lines are included as raw frames.
 * Documented limitation: Ruby, Go, Rust not supported in MVP.
 */
export function parseStackTrace(raw: string): ParsedFrame[] {
    const lines = raw.split("\n");
    const frames: ParsedFrame[] = [];

    for (const line of lines) {
        if (!line.trim()) continue;

        // More specific patterns before V8 (V8 fallback is too greedy)
        const parsed =
            parsePython(line) ??
            parseJava(line) ??
            parseV8(line);

        if (parsed) {
            frames.push(parsed);
        } else if (line.startsWith("    at ") || line.startsWith("\tat ")) {
            // Looks like a frame line we couldn't parse — include as raw
            frames.push({ raw: line });
        }
        // Lines like the error message itself (first line) are skipped
    }

    return frames;
}
