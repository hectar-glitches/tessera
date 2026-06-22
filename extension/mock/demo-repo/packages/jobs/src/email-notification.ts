import { task, wait } from "@trigger.dev/sdk/v3";
import { logger } from "@acme/shared/logger";

// Background job: send a welcome email after a user signs up.
// Triggered via client.sendEvent({ name: "user.created", payload: { userId, email } })
// Retries: 3x with exponential backoff. Failed jobs page #eng-alerts on Slack.
// Monitor at: https://cloud.trigger.dev — use the "Engineering" project.

export const sendWelcomeEmail = task({
  id: "send-welcome-email",
  maxDuration: 60,
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 1000 },

  run: async (payload: { userId: string; email: string; name: string }) => {
    logger.info("job.send-welcome-email.start", { userId: payload.userId });

    // Wait 30 seconds so Clerk finishes provisioning before we try to look up the user.
    await wait.for({ seconds: 30 });

    await sendEmail({
      to: payload.email,
      subject: "Welcome to AcmeCorp",
      body: `Hi ${payload.name ?? "there"}, welcome aboard!`,
    });

    logger.info("job.send-welcome-email.done", { userId: payload.userId });
    return { sent: true };
  },
});

export const exportWorkspaceData = task({
  id: "export-workspace-data",
  maxDuration: 300,
  retry: { maxAttempts: 2, factor: 2, minTimeoutInMs: 5000 },

  run: async (payload: { workspaceId: string; requestedBy: string }) => {
    logger.info("job.export-workspace-data.start", payload);
    // ...collect data, write to S3, email download link
    return { exported: true };
  },
});

// Stub — replace with your email provider (Resend, Postmark, etc.)
async function sendEmail(opts: { to: string; subject: string; body: string }) {
  logger.info("email.send", { to: opts.to, subject: opts.subject });
}
