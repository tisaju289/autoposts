import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PostPilot — Facebook post scheduler" },
      { name: "description", content: "Upload post designs, auto Bangla captions, schedule and auto-post to your Facebook Page." },
      { property: "og:title", content: "PostPilot — Facebook post scheduler" },
      { property: "og:description", content: "Upload post designs, auto Bangla captions, schedule and auto-post to your Facebook Page." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
