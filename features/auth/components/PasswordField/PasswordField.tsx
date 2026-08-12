"use client";
import { useState } from "react";
import { Input, IconButton } from "@/shared/components";
import type { InputProps } from "@/shared/components";

type PasswordFieldProps = Omit<InputProps, "type" | "suffix">;

const EYE_PATH = "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z";
const EYE_OFF_PATH =
    "M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24";

export function PasswordField(props: PasswordFieldProps) {
    const [visible, setVisible] = useState(false);

    return (
        <Input
            {...props}
            type={visible ? "text" : "password"}
            suffix={
                <IconButton
                    size="sm"
                    aria-label={visible ? "Hide password" : "Show password"}
                    onClick={() => setVisible((v) => !v)}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                        {visible ? (
                            <>
                                <path d={EYE_OFF_PATH} />
                                <line x1="1" y1="1" x2="23" y2="23" />
                            </>
                        ) : (
                            <>
                                <path d={EYE_PATH} />
                                <circle cx="12" cy="12" r="3" />
                            </>
                        )}
                    </svg>
                </IconButton>
            }
        />
    );
}
