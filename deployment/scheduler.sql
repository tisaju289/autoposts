-- Customer project only: enable pg_cron and pg_net through extension settings first.
-- Replace this URL with the CUSTOMER'S live HTTPS site, never the seller site.
-- Keep this job private. It reads the generated token without printing it.
SELECT cron.schedule('autoposts-publish-due', '*/5 * * * *', $job$
 SELECT net.http_post(
   url := 'https://YOUR-CUSTOMER-SITE/api/public/hooks/publish-due',
   headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT token FROM private.cron_token WHERE id = 1)),
   body := '{}'::jsonb,
   timeout_milliseconds := 120000
 );
$job$);
-- Verify scheduler requests in the pg_net response table, without logging tokens:
-- SELECT status_code, timed_out, created FROM net._http_response ORDER BY created DESC LIMIT 5;
