"use client";

import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { setProjectContext } from "@/core/store/slices/project";

interface ProjectHydratorProps {
    projectId: string;
    projectSlug: string;
    projectName: string;
    orgId: string;
}

export function ProjectHydrator({ projectId, projectSlug, projectName, orgId }: ProjectHydratorProps) {
    const dispatch = useDispatch();

    useEffect(() => {
        dispatch(setProjectContext({ projectId, projectSlug, projectName, orgId }));
    }, [dispatch, projectId, projectSlug, projectName, orgId]);

    return null;
}
