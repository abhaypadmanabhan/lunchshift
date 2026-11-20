import { ParentApp } from "@/components/parent/parent-app";

// The parent app with a slim "Next step" bar for the 3-minute recording. Steps call the same endpoints the app uses.
export default function DemoPage() {
  return <ParentApp demo />;
}
