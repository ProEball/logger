import { configureStore } from "@reduxjs/toolkit";
import themeReducer from "@/core/store/slices/theme";
import orgReducer from "@/core/store/slices/org";
import projectReducer from "@/core/store/slices/project";
import userReducer from "@/core/store/slices/user";

export const store = configureStore({
    reducer: {
        theme: themeReducer,
        org: orgReducer,
        project: projectReducer,
        user: userReducer,
    },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
