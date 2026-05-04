import { configureStore } from "@reduxjs/toolkit";
import themeReducer from "@/core/store/slices/theme";
import orgReducer from "@/core/store/slices/org";

export const store = configureStore({
    reducer: {
        theme: themeReducer,
        org: orgReducer,
    },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
