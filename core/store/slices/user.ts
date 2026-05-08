import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "@/core/store";
import type { AutoRefreshValue, UserPreferences } from "@/shared/types/user-preferences.types";
import { DEFAULT_PREFERENCES } from "@/shared/types/user-preferences.types";

interface UserState {
    preferences: UserPreferences;
}

const initialState: UserState = {
    preferences: DEFAULT_PREFERENCES,
};

const userSlice = createSlice({
    name: "user",
    initialState,
    reducers: {
        setPreferences(state, action: PayloadAction<UserPreferences>) {
            state.preferences = action.payload;
        },
        setAutoRefresh(state, action: PayloadAction<AutoRefreshValue>) {
            state.preferences.autoRefresh = action.payload;
        },
    },
});

export const { setPreferences, setAutoRefresh } = userSlice.actions;
export default userSlice.reducer;

// Selectors
export const selectPreferences = (s: RootState): UserPreferences => s.user.preferences;
export const selectAutoRefresh = (s: RootState): AutoRefreshValue => s.user.preferences.autoRefresh;
