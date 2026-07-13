import { DashboardApp } from "@/components/dashboard/DashboardApp";

export default function HomePage() {
  const assistantE2EMode = process.env.ASSISTANT_E2E_MODE === "1" && process.env.NODE_ENV !== "production";
  return <DashboardApp assistantE2EMode={assistantE2EMode} />;
}
