type GraphError = { code?: number; message?: string };
type Payload = {
  error?: GraphError;
  reactions?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
  shares?: { count?: number };
  data?: { total_value?: { value?: number }; values?: { value?: number }[] }[];
};

function errorMessage(error?: GraphError) {
  if (error?.code === 190) return "Facebook টোকেনের মেয়াদ শেষ বা টোকেনটি অবৈধ। সেটিংসে নতুন Page টোকেন দিন।";
  if (error?.code === 10 || error?.code === 200) return "এই পোস্টে প্রবেশাধিকার নেই। সঠিক পেজের টোকেন ও pages_read_engagement/read_insights অনুমতি যাচাই করুন।";
  if (error?.code === 100) return "Facebook এই পোস্টের তথ্য বা হিসাবটি দিচ্ছে না।";
  return "Facebook থেকে তথ্য আনা যায়নি। আবার চেষ্টা করুন।";
}

export async function fetchPostStats(postId: string, token: string) {
  const read = async (path: string): Promise<Payload> => {
    const response = await fetch(`https://graph.facebook.com/v21.0/${postId}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json() as Payload;
    if (!response.ok && !payload.error) return { error: { code: response.status } };
    return payload;
  };
  const [engagement, insights] = await Promise.allSettled([
    read("?fields=reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares"),
    read("/insights?metric=post_total_media_view_unique"),
  ]);
  const e = engagement.status === "fulfilled" ? engagement.value : null;
  const i = insights.status === "fulfilled" ? insights.value : null;
  const metric = i?.data?.[0];
  const reach = i && !i.error ? metric?.total_value?.value ?? metric?.values?.[0]?.value ?? null : null;
  const errors: string[] = [];
  if (!e || e.error) errors.push(errorMessage(e?.error));
  if (reach === null) errors.push(`রিচ পাওয়া যায়নি। ${errorMessage(i?.error)}`);
  return {
    likes: e && !e.error ? e.reactions?.summary?.total_count ?? 0 : null,
    comments: e && !e.error ? e.comments?.summary?.total_count ?? 0 : null,
    shares: e && !e.error ? e.shares?.count ?? 0 : null,
    reach,
    error: errors.length ? [...new Set(errors)].join(" ") : null,
  };
}