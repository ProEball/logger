import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export type ThemeValue = "dark" | "light" | "system";

interface ThemeState {
    value: ThemeValue;
}

const initialState: ThemeState = {
    value: "dark",
};

export const themeSlice = createSlice({
    name: "theme",
    initialState,
    reducers: {
        setTheme(state, action: PayloadAction<ThemeValue>) {
            state.value = action.payload;
        },
    },
});

export const { setTheme } = themeSlice.actions;
export default themeSlice.reducer;
