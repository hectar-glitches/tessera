"use client";

import { useUser } from "@clerk/nextjs";
import { useFlag } from "@acme/shared/flags";

export default function Dashboard() {
  const { user, isLoaded } = useUser();
  const aiPanel = useFlag("ai-assistant-panel");

  if (!isLoaded) return <div className="p-8 text-gray-500">Loading…</div>;

  return (
    <main className="flex min-h-screen">
      <div className="flex-1 p-8">
        <h1 className="text-2xl font-semibold">
          Welcome back, {user?.firstName ?? "there"}
        </h1>
        <p className="mt-2 text-gray-600">
          Here is what is happening in your workspace today.
        </p>
        {/* workspace content */}
      </div>

      {aiPanel && (
        <aside className="w-80 border-l bg-gray-50 p-4">
          <h2 className="font-medium text-sm text-gray-700 mb-3">AI Assistant</h2>
          {/* AI panel — gated behind "ai-assistant-panel" LaunchDarkly flag */}
        </aside>
      )}
    </main>
  );
}
