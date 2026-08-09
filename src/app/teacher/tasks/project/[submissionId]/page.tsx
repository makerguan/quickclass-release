"use client";

import { useParams, useRouter } from "next/navigation";
import TeacherLayout from "@/components/layout/TeacherLayout";
import ProjectBrowseView from "../../ProjectBrowseView";

export default function ProjectBrowsePage() {
  const params = useParams();
  const router = useRouter();
  const submissionId = params.submissionId as string;

  return (
    <TeacherLayout>
      <ProjectBrowseView
        submissionId={submissionId}
        onBack={() => router.push("/teacher/tasks")}
      />
    </TeacherLayout>
  );
}
