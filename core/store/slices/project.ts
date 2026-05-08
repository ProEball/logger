import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

interface ProjectState {
    currentProjectId: string | null;
    currentProjectSlug: string | null;
    currentProjectName: string | null;
    currentOrgId: string | null;
}

const initialState: ProjectState = {
    currentProjectId: null,
    currentProjectSlug: null,
    currentProjectName: null,
    currentOrgId: null,
};

export const projectSlice = createSlice({
    name: "project",
    initialState,
    reducers: {
        setProjectContext(
            state,
            action: PayloadAction<{
                projectId: string;
                projectSlug: string;
                projectName: string;
                orgId: string;
            }>,
        ) {
            state.currentProjectId = action.payload.projectId;
            state.currentProjectSlug = action.payload.projectSlug;
            state.currentProjectName = action.payload.projectName;
            state.currentOrgId = action.payload.orgId;
        },
        clearProjectContext(state) {
            state.currentProjectId = null;
            state.currentProjectSlug = null;
            state.currentProjectName = null;
            state.currentOrgId = null;
        },
    },
});

export const { setProjectContext, clearProjectContext } = projectSlice.actions;

export const selectCurrentProject = (state: { project: ProjectState }) => ({
    id: state.project.currentProjectId,
    slug: state.project.currentProjectSlug,
    name: state.project.currentProjectName,
    orgId: state.project.currentOrgId,
});

export default projectSlice.reducer;
