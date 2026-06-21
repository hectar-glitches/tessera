import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getFlag } from "@acme/shared/flags";

// Root page — redirect logged-in users to their dashboard, guests to sign-in.
export default async function Home() {
  const user = await currentUser();

  if (!user) redirect("/sign-in");

  const showNewBilling = await getFlag("workspace-billing-v2", {
    kind: "user",
    key: user.id,
    email: user.emailAddresses[0]?.emailAddress,
  });

  redirect(showNewBilling ? "/dashboard/billing-v2" : "/dashboard");
}
