import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Membership } from "@/shared/permissions/check";

// Full org context — expanded in Feature 01 App Shell (item 56)
interface OrgState {
    currentOrgId: string | null;
    currentOrgSlug: string | null;
    currentMembership: Membership | null;
}

const initialState: OrgState = {
    currentOrgId: null,
    currentOrgSlug: null,
    currentMembership: null,
};

export const orgSlice = createSlice({
    name: "org",
    initialState,
    reducers: {
        setOrgContext(
            state,
            action: PayloadAction<{
                orgId: string;
                orgSlug: string;
                membership: Membership;
            }>,
        ) {
            state.currentOrgId = action.payload.orgId;
            state.currentOrgSlug = action.payload.orgSlug;
            state.currentMembership = action.payload.membership;
        },
        clearOrgContext(state) {
            state.currentOrgId = null;
            state.currentOrgSlug = null;
            state.currentMembership = null;
        },
    },
});

export const { setOrgContext, clearOrgContext } = orgSlice.actions;
export const selectCurrentMembership = (state: { org: OrgState }) =>
    state.org.currentMembership;
export default orgSlice.reducer;
